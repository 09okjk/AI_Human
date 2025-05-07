/**
 * 语音通话功能 - 简化版
 * 整合所有功能到一个类中以恢复基本功能
 */
class VoiceChat {
    constructor() {
        // 核心状态
        this.isCallActive = false;     // 通话是否活跃
        this.isRecording = false;      // 是否正在录音
        this.isAiSpeaking = false;     // AI是否正在说话
        this.sessionId = null;         // 会话ID
        
        // 音频相关
        this.audioContext = null;      // 音频上下文
        this.mediaRecorder = null;     // 媒体录制器
        this.mediaStream = null;       // 媒体流
        this.audioChunks = [];         // 音频数据块
        
        // 语音检测相关
        this.silenceTimer = null;      // 静音计时器
        this.silenceTimeout = 1800;    // 静音超时时间(ms)
        this.lastAudioLevel = 0;       // 音频电平
        this.vadAnimationFrame = null; // VAD动画帧
        
        // 打断和超时保护
        this.responseAbortController = null; // 响应中断控制器
        this.recordingTimeout = null;  // 录音超时保护
        this.MAX_RECORDING_TIME = 30000; // 最长录音30秒

        console.log("语音通话模块已初始化");
    }
    
    /**
     * 开始通话
     */
    async startCall() {
        try {
            if (this.isCallActive) {
                console.log("通话已经处于活跃状态");
                return;
            }
            
            this.updateStatus('开始通话中...');
            
            // 1. 创建服务器会话
            const response = await fetch('/api/call/start', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'}
            });
            
            if (!response.ok) {
                throw new Error(`服务器错误: ${response.status}`);
            }
            
            const data = await response.json();
            this.sessionId = data.session_id;
            
            // 2. 更新UI状态
            this.updateUIForCallStart();
            this.isCallActive = true;
            
            // 3. 初始化音频系统
            await this.initAudio();
            
            // 4. 开始录音和语音检测
            this.startVoiceDetection();
            this.startRecording();
            
            // 5. 添加通话提示
            this.addMessage('系统', '通话已开始，您可以开始说话', 'system');
            
        } catch (error) {
            console.error('启动通话失败:', error);
            this.updateStatus('通话启动失败: ' + error.message);
            this.updateUIForCallEnd();
        }
    }
    
    /**
     * 结束通话
     */
    async endCall() {
        if (!this.isCallActive) return;
        
        try {
            this.updateStatus('正在结束通话...');
            
            // 1. 更新状态
            this.isCallActive = false;
            
            // 2. 停止所有计时器
            this.cancelAllTimers();
            
            // 3. 停止录音和语音检测
            this.stopRecording();
            this.stopVoiceDetection();
            
            // 4. 中断响应
            this.abortCurrentResponse();
            
            // 5. 通知服务器结束会话
            if (this.sessionId) {
                await fetch('/api/call/end', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({session_id: this.sessionId})
                });
            }
            
            // 6. 清理资源
            this.sessionId = null;
            this.isAiSpeaking = false;
            await this.cleanupAudio();
            
            // 7. 更新UI
            this.updateUIForCallEnd();
            this.addMessage('系统', '通话已结束', 'system');
            
        } catch (error) {
            console.error('结束通话失败:', error);
            this.updateStatus('结束通话时出错: ' + error.message);
            this.isCallActive = false;
        }
    }
    
    /**
     * 取消所有计时器
     */
    cancelAllTimers() {
        clearTimeout(this.silenceTimer);
        clearTimeout(this.recordingTimeout);
        
        if (this.vadAnimationFrame) {
            cancelAnimationFrame(this.vadAnimationFrame);
            this.vadAnimationFrame = null;
        }
    }
    
    /**
     * 初始化音频系统
     */
    async initAudio() {
        try {
            // 创建音频上下文
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // 请求麦克风权限
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });
            
            // 确定支持的音频格式
            let mimeType = 'audio/wav';
            if (!MediaRecorder.isTypeSupported('audio/wav')) {
                if (MediaRecorder.isTypeSupported('audio/webm')) {
                    mimeType = 'audio/webm';
                } else {
                    mimeType = ''; // 使用默认格式
                }
            }
            
            // 创建媒体录制器
            this.mediaRecorder = new MediaRecorder(this.mediaStream, {
                mimeType: mimeType || undefined
            });
            
            // 设置录音数据处理
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };
            
            console.log("音频系统初始化完成，使用格式:", this.mediaRecorder.mimeType);
            
        } catch (error) {
            console.error('初始化音频失败:', error);
            throw error;
        }
    }
    
    /**
     * 开始语音检测
     */
    startVoiceDetection() {
        if (!this.audioContext || !this.mediaStream) return;
        
        try {
            // 创建分析器
            const analyser = this.audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.5;
            
            // 连接媒体源
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            source.connect(analyser);
            
            // 创建数据缓冲区
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            
            let isSpeaking = false;
            let silentFrames = 0;
            let speechFrames = 0;
            
            // 分析函数
            const analyzeAudio = () => {
                if (!this.isCallActive) return;
                
                analyser.getByteFrequencyData(dataArray);
                
                // 计算能量
                let sum = 0;
                const lowerBin = Math.floor(bufferLength * 0.1);
                const upperBin = Math.floor(bufferLength * 0.7);
                
                for (let i = lowerBin; i < upperBin; i++) {
                    sum += dataArray[i];
                }
                
                // 归一化能量值
                const energyLevel = sum / ((upperBin - lowerBin) * 255);
                this.lastAudioLevel = energyLevel;
                
                // 检测说话状态
                if (energyLevel > 0.015) { // 阈值
                    speechFrames++;
                    silentFrames = 0;
                    if (speechFrames > 5) { // 连续5帧说话
                        if (!isSpeaking) {
                            isSpeaking = true;
                            this.handleSpeechStart();
                        }
                    }
                } else {
                    silentFrames++;
                    speechFrames = 0;
                    if (silentFrames > 15) { // 连续15帧静音
                        if (isSpeaking) {
                            isSpeaking = false;
                            this.handleSpeechEnd();
                        }
                    }
                }
                
                // 更新指示器
                this.updateRecordingIndicator(isSpeaking);
                
                // 继续检测
                this.vadAnimationFrame = requestAnimationFrame(analyzeAudio);
            };
            
            // 开始分析
            this.vadAnimationFrame = requestAnimationFrame(analyzeAudio);
            
        } catch (error) {
            console.error('启动语音检测失败:', error);
        }
    }
    
    /**
     * 处理用户开始说话
     */
    handleSpeechStart() {
        // 清除静音计时器
        clearTimeout(this.silenceTimer);
        
        // 如果AI正在说话，发送打断信号
        if (this.isAiSpeaking) {
            this.interruptAI();
        }
        
        // 确保录音已开始
        if (!this.isRecording && this.isCallActive) {
            this.startRecording();
        }
        
        // 更新状态
        this.updateStatus('正在说话...');
    }
    
    /**
     * 处理用户停止说话
     */
    handleSpeechEnd() {
        // 清除之前的静音计时器
        clearTimeout(this.silenceTimer);
        
        // 更新状态
        this.updateStatus('检测到语音停止...');
        
        // 设置新的静音计时器
        this.silenceTimer = setTimeout(() => {
            if (this.isRecording && this.audioChunks.length > 0 && this.isCallActive) {
                this.processRecording();
            }
        }, this.silenceTimeout);
    }
    
    /**
     * 停止语音检测
     */
    stopVoiceDetection() {
        if (this.vadAnimationFrame) {
            cancelAnimationFrame(this.vadAnimationFrame);
            this.vadAnimationFrame = null;
        }
    }
    
    /**
     * 开始录音
     */
    startRecording() {
        if (this.isRecording || !this.isCallActive) return;
        
        try {
            // 清空之前的音频数据
            this.audioChunks = [];
            
            // 开始录音
            if (this.mediaRecorder && this.mediaRecorder.state !== 'recording') {
                this.mediaRecorder.start(100);
                this.isRecording = true;
                console.log('开始录音');
                
                // 更新UI
                document.getElementById('voice-button').classList.add('recording');
                
                // 设置超时保护
                clearTimeout(this.recordingTimeout);
                this.recordingTimeout = setTimeout(() => {
                    console.log("录音超时（30秒），自动处理");
                    if (this.isRecording) {
                        this.processRecording();
                    }
                }, this.MAX_RECORDING_TIME);
            }
        } catch (error) {
            console.error('开始录音失败:', error);
            this.isRecording = false;
        }
    }
    
    /**
     * 停止录音
     */
    stopRecording() {
        if (!this.isRecording) return;
        
        try {
            // 清除超时保护
            clearTimeout(this.recordingTimeout);
            
            // 停止录音
            if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                this.mediaRecorder.stop();
                console.log('停止录音');
                
                // 更新UI
                document.getElementById('voice-button').classList.remove('recording');
            }
            
            // 更新状态
            this.isRecording = false;
        } catch (error) {
            console.error('停止录音失败:', error);
            this.isRecording = false;
        }
    }
    
    /**
     * 处理录音数据并发送
     */
    async processRecording() {
        if (!this.isCallActive || this.audioChunks.length === 0) return;
        
        try {
            // 停止录音
            this.stopRecording();
            this.updateStatus('处理音频中...');
            
            // 创建录音Blob
            const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
            const audioBlob = new Blob(this.audioChunks, { type: mimeType });
            
            // 检查大小
            if (audioBlob.size < 1000) {
                console.log("录音数据过小，忽略处理");
                this.audioChunks = [];
                
                // 重新开始录音
                if (this.isCallActive) {
                    setTimeout(() => this.startRecording(), 100);
                }
                return;
            }
            
            // 转换为base64
            const base64Audio = await this.blobToBase64(audioBlob);
            
            // 发送到服务器
            await this.sendAudioToServer(base64Audio);
            
            // 清空数据
            this.audioChunks = [];
            
        } catch (error) {
            console.error('处理录音失败:', error);
            this.updateStatus('处理失败: ' + error.message);
        } finally {
            // 如果通话仍在进行，重新开始录音
            if (this.isCallActive) {
                setTimeout(() => {
                    if (this.isCallActive && !this.isRecording) {
                        this.startRecording();
                    }
                }, 300);
            }
        }
    }
    
    /**
     * 发送文本消息
     */
    async sendTextMessage(text) {
        if (!text) return;
        
        try {
            this.updateStatus('发送文本消息...');
            this.addMessage('您', text, 'user');
            
            // 发送到服务器
            const response = await fetch('/api/text-only', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text })
            });
            
            if (!response.ok) {
                throw new Error(`服务器错误: ${response.status}`);
            }
            
            // 处理服务器响应
            this.handleServerResponse('/api/text-only');
            
        } catch (error) {
            console.error('发送文本失败:', error);
            this.updateStatus('发送失败: ' + error.message);
            this.addMessage('系统', `发送失败: ${error.message}`, 'system');
        }
    }
    
    /**
     * 将Blob转换为Base64
     */
    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
    
    /**
     * 发送音频到服务器
     */
    async sendAudioToServer(audioData) {
        if (!this.sessionId && !this.isCallActive) {
            // 如果不是会话模式，使用普通音频API
            return this.sendSingleAudio(audioData);
        }
        
        try {
            this.updateStatus('发送音频到服务器...');
            
            // 准备请求数据
            const requestData = {
                audio: audioData,
                session_id: this.sessionId,
                audio_level: this.lastAudioLevel,
                is_final: true
            };
            
            // 发送请求
            const response = await fetch('/api/voice-chat', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(requestData)
            });
            
            if (!response.ok) {
                throw new Error(`服务器错误: ${response.status}`);
            }
            
            // 添加用户消息
            this.addMessage('您', '[语音输入]', 'user');
            
            // 处理服务器响应
            await this.handleServerResponse('/api/voice-chat/stream');
            
        } catch (error) {
            console.error('发送音频失败:', error);
            this.updateStatus('发送失败: ' + error.message);
            this.addMessage('系统', `发送失败: ${error.message}`, 'system');
        }
    }
    
    /**
     * 发送单次音频（非会话模式）
     */
    async sendSingleAudio(audioData) {
        try {
            this.updateStatus('发送音频到服务器...');
            this.addMessage('您', '[语音输入]', 'user');
            
            // 发送请求
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ audio: audioData })
            });
            
            if (!response.ok) {
                throw new Error(`服务器错误: ${response.status}`);
            }
            
            // 处理服务器响应
            await this.handleServerResponse('/api/chat');
            
        } catch (error) {
            console.error('发送音频失败:', error);
            this.updateStatus('发送失败: ' + error.message);
            this.addMessage('系统', `发送失败: ${error.message}`, 'system');
        }
    }
    
    /**
     * 处理服务器响应
     */
    async handleServerResponse(endpoint) {
        this.updateStatus('等待AI回复...');
        
        try {
            // 创建中断控制器
            this.responseAbortController = new AbortController();
            const signal = this.responseAbortController.signal;
            
            // 如果是会话模式且需要使用专门的流式端点
            const url = this.sessionId ? 
                `${endpoint}?session_id=${this.sessionId}&_=${Date.now()}` :
                `${endpoint}?_=${Date.now()}`; 
            
            // 如果是会话模式的流式响应
            if (endpoint === '/api/voice-chat/stream' && this.sessionId) {
                const response = await fetch('/api/voice-chat/stream', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ session_id: this.sessionId }),
                    signal: signal
                });
                
                if (!response.ok) {
                    throw new Error(`接收响应错误: ${response.status}`);
                }
                
                await this.processStreamResponse(response.body);
            } 
            // 否则使用EventSource处理其他类型的流式响应
            else {
                const eventSource = new EventSource(url);
                
                let aiMessage = '';
                let hasAudio = false;
                this.isAiSpeaking = true;
                
                eventSource.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        
                        switch (data.type) {
                            case 'text':
                                aiMessage += data.content;
                                this.updateAIMessage(aiMessage);
                                break;
                                
                            case 'audio':
                                this.playAudio(data.content);
                                hasAudio = true;
                                break;
                                
                            case 'transcript':
                                console.log('转写:', data.content);
                                break;
                                
                            case 'error':
                                this.updateStatus('错误: ' + data.content);
                                this.addMessage('系统', `错误: ${data.content}`, 'system');
                                break;
                        }
                    } catch (error) {
                        console.error('解析响应失败:', error, event.data);
                    }
                };
                
                eventSource.onerror = () => {
                    eventSource.close();
                    this.isAiSpeaking = false;
                    
                    // 完成消息
                    if (aiMessage) {
                        this.completeAIMessage(aiMessage, hasAudio);
                    }
                    
                    this.updateStatus('就绪');
                };
                
                // 保存引用以便可以中断
                this._eventSource = eventSource;
            }
            
        } catch (error) {
            // 忽略中断错误
            if (error.name === 'AbortError') {
                console.log('响应已被用户中断');
                return;
            }
            
            console.error('接收AI响应失败:', error);
            this.isAiSpeaking = false;
            this.updateStatus('接收响应失败: ' + error.message);
        }
    }
    
    /**
     * 处理流式响应
     */
    async processStreamResponse(responseStream) {
        let aiMessage = '';
        let hasAudio = false;
        this.isAiSpeaking = true;
        
        try {
            const reader = responseStream.getReader();
            const decoder = new TextDecoder();
            
            while (true) {
                const { done, value } = await reader.read();
                
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n\n');
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.substring(6));
                            
                            switch (data.type) {
                                case 'text':
                                    aiMessage += data.content;
                                    this.updateAIMessage(aiMessage);
                                    this.updateStatus('AI正在回复...');
                                    break;
                                    
                                case 'audio':
                                    this.playAudio(data.content);
                                    hasAudio = true;
                                    this.updateStatus('AI正在语音回复...');
                                    break;
                                    
                                case 'transcript':
                                    console.log('语音转写:', data.content);
                                    break;
                                    
                                case 'interrupted':
                                    this.updateStatus('已打断AI回复');
                                    this.isAiSpeaking = false;
                                    return;
                                    
                                case 'error':
                                    this.addMessage('系统', `错误: ${data.content}`, 'system');
                                    this.updateStatus('发生错误: ' + data.content);
                                    this.isAiSpeaking = false;
                                    return;
                            }
                        } catch (error) {
                            console.error('解析响应数据失败:', error, line);
                        }
                    }
                }
            }
            
            // 响应完成，保存完整消息
            if (aiMessage) {
                this.completeAIMessage(aiMessage, hasAudio);
            }
            
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('处理流式响应失败:', error);
            }
        } finally {
            this.isAiSpeaking = false;
            this.updateStatus('等待您说话');
        }
    }
    
    /**
     * 播放音频
     */
    playAudio(base64Data) {
        try {
            const base64Audio = base64Data.replace(/^data:audio\/[^;]+;base64,/, '');
            const audioData = atob(base64Audio);
            
            const uint8Array = new Uint8Array(audioData.length);
            for (let i = 0; i < audioData.length; i++) {
                uint8Array[i] = audioData.charCodeAt(i);
            }
            
            const blob = new Blob([uint8Array], { type: 'audio/wav' });
            const audioUrl = URL.createObjectURL(blob);
            
            const audio = new Audio(audioUrl);
            audio.onended = () => URL.revokeObjectURL(audioUrl);
            audio.play();
            
        } catch (error) {
            console.error('播放音频失败:', error);
        }
    }
    
    /**
     * 中断AI响应
     */
    interruptAI() {
        if (!this.isAiSpeaking) return;
        
        console.log('打断AI响应');
        
        // 关闭事件源
        if (this._eventSource) {
            this._eventSource.close();
            this._eventSource = null;
        }
        
        // 中断流式请求
        if (this.responseAbortController) {
            this.responseAbortController.abort();
            this.responseAbortController = null;
        }
        
        // 如果是会话模式，通知服务器
        if (this.sessionId) {
            fetch('/api/call/interrupt', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ session_id: this.sessionId })
            }).catch(error => {
                console.error('发送打断信号失败:', error);
            });
        }
        
        this.isAiSpeaking = false;
        this.updateStatus('用户打断了AI');
    }
    
    /**
     * 中断当前响应
     */
    abortCurrentResponse() {
        // 关闭事件源
        if (this._eventSource) {
            this._eventSource.close();
            this._eventSource = null;
        }
        
        // 中断流式请求
        if (this.responseAbortController) {
            this.responseAbortController.abort();
            this.responseAbortController = null;
        }
        
        this.isAiSpeaking = false;
    }
    
    /**
     * 更新AI消息
     */
    updateAIMessage(message) {
        let aiMessageElem = document.getElementById('current-ai-message');
        
        if (!aiMessageElem) {
            aiMessageElem = document.createElement('div');
            aiMessageElem.id = 'current-ai-message';
            aiMessageElem.className = 'message ai';
            
            const chatMessages = document.getElementById('chat-messages');
            if (chatMessages) {
                chatMessages.appendChild(aiMessageElem);
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
        }
        
        aiMessageElem.textContent = message;
    }
    
    /**
     * 完成AI消息
     */
    completeAIMessage(message, hadAudio = false) {
        const aiMessageElem = document.getElementById('current-ai-message');
        if (aiMessageElem) {
            aiMessageElem.id = '';
        }
        
        let displayMsg = message;
        if (hadAudio) {
            displayMsg += ' [语音已播放]';
        }
        this.addMessage('AI', displayMsg, 'ai');
    }
    
    /**
     * 添加消息
     */
    addMessage(sender, content, type = 'user') {
        const chatMessages = document.getElementById('chat-messages');
        if (!chatMessages) return;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        
        if (type === 'system') {
            messageDiv.classList.add('system-message');
            messageDiv.textContent = content;
        } else {
            const nameSpan = document.createElement('div');
            nameSpan.className = 'message-sender';
            nameSpan.textContent = sender;
            
            const contentSpan = document.createElement('div');
            contentSpan.className = 'message-content';
            contentSpan.textContent = content;
            
            messageDiv.appendChild(nameSpan);
            messageDiv.appendChild(contentSpan);
        }
        
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    
    /**
     * 更新状态
     */
    updateStatus(message) {
        const statusMessage = document.getElementById('status-message');
        if (statusMessage) {
            statusMessage.textContent = message;
        }
    }
    
    /**
     * 更新录音指示器
     */
    updateRecordingIndicator(isSpeaking) {
        const indicator = document.getElementById('recording-indicator');
        if (indicator) {
            if (isSpeaking && this.isRecording) {
                indicator.classList.add('active');
            } else {
                indicator.classList.remove('active');
            }
        }
    }
    
    /**
     * 更新UI为通话开始状态
     */
    updateUIForCallStart() {
        const startBtn = document.getElementById('start-call');
        const endBtn = document.getElementById('end-call');
        
        if (startBtn) startBtn.disabled = true;
        if (endBtn) endBtn.disabled = false;
    }
    
    /**
     * 更新UI为通话结束状态
     */
    updateUIForCallEnd() {
        const startBtn = document.getElementById('start-call');
        const endBtn = document.getElementById('end-call');
        
        if (startBtn) startBtn.disabled = false;
        if (endBtn) endBtn.disabled = true;
        
        const voiceButton = document.getElementById('voice-button');
        if (voiceButton) voiceButton.classList.remove('recording');
        
        const indicator = document.getElementById('recording-indicator');
        if (indicator) indicator.classList.remove('active');
    }
    
    /**
     * 清理音频资源
     */
    async cleanupAudio() {
        console.log('清理音频资源');
        
        if (this.mediaRecorder) {
            try {
                if (this.mediaRecorder.state === 'recording') {
                    this.mediaRecorder.stop();
                }
            } catch (e) {
                console.warn('停止录音时出错:', e);
            }
            this.mediaRecorder = null;
        }
        
        if (this.mediaStream) {
            try {
                const tracks = this.mediaStream.getTracks();
                tracks.forEach(track => track.stop());
                this.mediaStream = null;
            } catch (e) {
                console.warn('停止媒体轨道时出错:', e);
            }
        }
        
        if (this.audioContext) {
            try {
                await this.audioContext.close();
                this.audioContext = null;
            } catch (e) {
                console.warn('关闭音频上下文时出错:', e);
            }
        }
        
        this.audioChunks = [];
    }
}

// 导出类
export default VoiceChat;
