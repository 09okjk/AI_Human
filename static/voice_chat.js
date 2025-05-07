/**
 * 实时语音通话功能 - 重构版
 * 提供更简洁、可靠的语音交互体验
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
        this.vadProcessor = null;      // 语音活动检测处理器
        this.silenceTimer = null;      // 静音计时器
        this.silenceTimeout = 1800;    // 静音超时时间(ms)，1.8秒无声判定说话结束
        this.lastAudioLevel = 0;       // 最后的音频电平
        this.speakingThreshold = 0.015; // 说话阈值
        this.vadAnimationFrame = null; // VAD动画帧
        this.consecutiveSilentFrames = 0; // 连续静音帧数
        this.consecutiveSpeakingFrames = 0; // 连续说话帧数
        
        // 流式响应相关
        this.responseController = null; // 响应控制器
        this.responseAbortController = null; // 响应中断控制器
        
        // 防抖与超时保护
        this.recordingTimeout = null;  // 录音超时保护
        this.MAX_RECORDING_TIME = 30000; // 最长录音30秒

        // 初始化
        console.log("语音通话模块已初始化");
    }
    
    /**
     * 开始通话 - 创建会话并初始化音频
     */
    async startCall() {
        try {
            // 防止重复启动
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
            await this.initAudioSystem();
            
            // 4. 开始语音检测和录音
            this.startVoiceDetection();
            this.startRecording();
            
            // 5. 添加通话开始提示
            this.addMessage('系统', '通话已开始，您可以开始说话', 'system');
            this.updateStatus('通话已开始，请说话');
            
        } catch (error) {
            console.error('启动通话失败:', error);
            this.updateStatus('通话启动失败: ' + error.message);
            this.updateUIForCallEnd();
        }
    }
    
    /**
     * 结束通话 - 清理资源并通知服务器
     */
    async endCall() {
        if (!this.isCallActive) return;
        
        try {
            this.updateStatus('正在结束通话...');
            console.log("结束通话，正在清理资源...");
            
            // 1. 立即更新状态，防止后续操作
            this.isCallActive = false;
            
            // 2. 取消所有计时器和进行中的操作
            this.cancelAllTimers();
            
            // 3. 停止录音和语音检测
            this.stopRecording();
            this.stopVoiceDetection();
            
            // 4. 中断所有正在进行的AI响应
            this.abortCurrentResponse();
            
            // 5. 通知服务器结束会话
            if (this.sessionId) {
                try {
                    await fetch('/api/call/end', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({session_id: this.sessionId})
                    });
                } catch (error) {
                    console.error("通知服务器结束通话失败", error);
                }
            }
            
            // 6. 重置状态变量
            this.sessionId = null;
            this.isAiSpeaking = false;
            
            // 7. 清理音频资源
            await this.cleanupAudio();
            
            // 8. 更新UI
            this.updateUIForCallEnd();
            this.updateStatus('通话已结束');
            
            // 9. 添加会话结束提示
            this.addMessage('系统', '通话已结束', 'system');
            
        } catch (error) {
            console.error('结束通话失败:', error);
            this.updateStatus('结束通话时出错: ' + error.message);
            this.updateUIForCallEnd();
        }
    }
    
    /**
     * 取消所有计时器和动画帧
     */
    cancelAllTimers() {
        // 取消所有计时器
        clearTimeout(this.silenceTimer);
        clearTimeout(this.recordingTimeout);
        
        // 取消VAD动画帧
        if (this.vadAnimationFrame) {
            cancelAnimationFrame(this.vadAnimationFrame);
            this.vadAnimationFrame = null;
        }
    }
    
    /**
     * 初始化音频系统 - 获取麦克风权限和设置音频处理
     */
    async initAudioSystem() {
        try {
            // 1. 创建音频上下文
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // 2. 请求麦克风权限
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true, // 回声消除
                    noiseSuppression: true, // 噪音抑制
                    autoGainControl: true   // 自动增益控制
                } 
            });
            
            // 3. 确定支持的音频格式
            let mimeType = 'audio/wav';
            if (!MediaRecorder.isTypeSupported('audio/wav')) {
                if (MediaRecorder.isTypeSupported('audio/webm')) {
                    mimeType = 'audio/webm';
                } else {
                    mimeType = ''; // 使用默认格式
                }
            }
            
            // 4. 创建媒体录制器
            this.mediaRecorder = new MediaRecorder(this.mediaStream, {
                mimeType: mimeType || undefined
            });
            
            // 5. 设置录音数据处理
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
     * 开始语音检测 - 监测用户是否在说话
     */
    startVoiceDetection() {
        if (!this.audioContext || !this.mediaStream) return;
        
        try {
            // 1. 创建分析节点
            const analyser = this.audioContext.createAnalyser();
            analyser.fftSize = 256; // FFT大小
            analyser.smoothingTimeConstant = 0.5; // 平滑系数，减少波动
            
            // 2. 连接媒体源到分析节点
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            source.connect(analyser);
            
            // 3. 设置数据缓冲区
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            
            // 4. 定义音频分析函数
            const analyzeAudio = () => {
                // 如果通话已结束，停止检测
                if (!this.isCallActive) {
                    console.log("通话已结束，停止语音检测");
                    return;
                }
                
                // 获取频域数据
                analyser.getByteFrequencyData(dataArray);
                
                // 计算人声频率范围的能量 (300Hz-3400Hz)
                // 对WebAudio API的frequencyBinCount来说，这大致对应于数组的前30%到70%
                let sumEnergy = 0;
                const lowerBin = Math.floor(bufferLength * 0.1);  // ~300Hz
                const upperBin = Math.floor(bufferLength * 0.7);  // ~3400Hz
                
                for (let i = lowerBin; i < upperBin; i++) {
                    sumEnergy += dataArray[i];
                }
                
                // 归一化能量值 (0-1)
                const energyLevel = sumEnergy / ((upperBin - lowerBin) * 255);
                this.lastAudioLevel = energyLevel;
                
                // 使用门限检测和滞后处理判断是否在说话
                const isSpeakingNow = energyLevel > this.speakingThreshold;
                
                if (isSpeakingNow) {
                    this.consecutiveSpeakingFrames++;
                    this.consecutiveSilentFrames = 0;
                    
                    // 需要连续3帧以上检测到声音才确认为说话
                    if (this.consecutiveSpeakingFrames >= 3) {
                        this.handleSpeaking();
                    }
                } else {
                    this.consecutiveSilentFrames++;
                    this.consecutiveSpeakingFrames = 0;
                    
                    // 需要连续10帧以上检测不到声音才确认为静音
                    if (this.consecutiveSilentFrames >= 10) {
                        this.handleSilence();
                    }
                }
                
                // 更新录音指示器
                this.updateRecordingIndicator(this.consecutiveSpeakingFrames >= 3);
                
                // 继续检测
                this.vadAnimationFrame = requestAnimationFrame(analyzeAudio);
            };
            
            // 5. 开始音频分析
            this.vadAnimationFrame = requestAnimationFrame(analyzeAudio);
            
        } catch (error) {
            console.error("启动语音检测失败:", error);
        }
    }
    
    /**
     * 处理检测到用户正在说话的情况
     */
    handleSpeaking() {
        // 清除静音计时器
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
        
        // 如果AI正在说话，发送打断信号
        if (this.isAiSpeaking) {
            this.interruptAIResponse();
        }
        
        // 确保录音已经开始
        if (!this.isRecording && this.isCallActive) {
            this.startRecording();
        }
        
        // 更新UI显示
        this.updateStatus('正在说话...');
    }
    
    /**
     * 处理检测到用户停止说话的情况
     */
    handleSilence() {
        // 如果没有在录音，则不需处理
        if (!this.isRecording) return;
        
        // 如果已经有静音计时器，不需要重复设置
        if (this.silenceTimer) return;
        
        // 显示等待状态
        this.updateStatus('检测到语音停止，等待中...');
        
        // 设置静音计时器，如果持续静音超过阈值，则认为用户说话结束
        this.silenceTimer = setTimeout(() => {
            // 如果有录音数据且通话仍然活跃，则处理录音
            if (this.audioChunks.length > 0 && this.isCallActive) {
                console.log("检测到用户停止说话，处理录音数据");
                this.processRecording();
            }
            this.silenceTimer = null;
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
        // 如果已经在录音或通话不活跃，不执行操作
        if (this.isRecording || !this.isCallActive) return;
        
        try {
            // 清空之前的录音数据
            this.audioChunks = [];
            
            // 确保MediaRecorder可用
            if (this.mediaRecorder && this.mediaRecorder.state !== 'recording') {
                // 开始录音，每100ms获取一次数据
                this.mediaRecorder.start(100);
                this.isRecording = true;
                console.log('开始录音');
                
                // 更新UI显示录音状态
                const voiceButton = document.getElementById('voice-button');
                if (voiceButton) voiceButton.classList.add('recording');
                
                // 设置录音超时保护，防止录音时间过长
                this.recordingTimeout = setTimeout(() => {
                    console.log("录音超时（最长30秒），自动处理");
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
        // 如果没有在录音，不执行操作
        if (!this.isRecording) return;
        
        try {
            // 清除录音超时保护
            clearTimeout(this.recordingTimeout);
            
            // 停止录音
            if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                this.mediaRecorder.stop();
                console.log('停止录音');
                
                // 更新UI
                const voiceButton = document.getElementById('voice-button');
                if (voiceButton) voiceButton.classList.remove('recording');
            }
            
            // 更新录音状态
            this.isRecording = false;
        } catch (error) {
            console.error('停止录音失败:', error);
            this.isRecording = false;
        }
    }
    
    /**
     * 处理录音数据 - 停止录音并发送到服务器
     */
    async processRecording() {
        // 防止重复处理
        if (!this.isCallActive) return;
        
        try {
            // 停止当前录音
            this.stopRecording();
            this.updateStatus('处理音频中...');
            
            // 如果没有录音数据，直接返回
            if (this.audioChunks.length === 0) {
                console.log("没有录音数据，跳过处理");
                return;
            }
            
            // 获取录音MIME类型
            const mimeType = this.mediaRecorder.mimeType || 'audio/webm';
            
            // 创建录音Blob
            const audioBlob = new Blob(this.audioChunks, { type: mimeType });
            
            // 检查录音大小，避免处理太小的噪声
            if (audioBlob.size < 1000) {
                console.log("录音数据过小，可能只是噪声，跳过处理", audioBlob.size);
                this.audioChunks = [];
                
                // 重新开始录音
                if (this.isCallActive) {
                    setTimeout(() => this.startRecording(), 100);
                }
                return;
            }
            
            // 转换为base64格式
            console.log("转换音频为base64格式...");
            const base64Audio = await this.blobToBase64(audioBlob);
            
            // 发送到服务器
            console.log("发送音频到服务器...");
            await this.sendAudioToServer(base64Audio);
            
            // 清空录音数据
            this.audioChunks = [];
            
        } catch (error) {
            console.error('处理录音失败:', error);
            this.updateStatus('处理录音失败: ' + error.message);
        } finally {
            // 如果通话仍在进行，延迟一会重新开始录音
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
     * 将Blob转换为Base64格式
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
     * 将音频数据发送到服务器并处理响应
     */
    async sendAudioToServer(audioData) {
        if (!this.sessionId || !this.isCallActive) return;
        
        try {
            this.updateStatus('发送数据到服务器...');
            
            // 准备请求数据
            const requestData = {
                audio: audioData,
                session_id: this.sessionId,
                audio_level: this.lastAudioLevel
            };
            
            // 发送POST请求
            const response = await fetch('/api/voice-chat', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(requestData)
            });
            
            if (!response.ok) {
                throw new Error(`服务器错误: ${response.status}`);
            }
            
            // 添加用户消息到聊天界面
            this.addMessage('您', '[语音输入]', 'user');
            
            // 接收AI响应
            await this.receiveAIResponse();
            
        } catch (error) {
            console.error('发送音频失败:', error);
            this.updateStatus('发送失败: ' + error.message);
            
            if (error.message.includes('Failed to fetch')) {
                this.addMessage('系统', '连接服务器失败，请检查网络连接', 'system');
            }
        }
    }
    
    /**
     * 接收并处理AI的流式响应
     */
    async receiveAIResponse() {
        if (!this.sessionId || !this.isCallActive) return;
        
        try {
            this.updateStatus('等待AI回复...');
            
            // 创建中断控制器，用于在需要时中断响应
            this.responseAbortController = new AbortController();
            const { signal } = this.responseAbortController;
            
            // 发送流式请求
            const response = await fetch('/api/voice-chat/stream', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ session_id: this.sessionId }),
                signal: signal
            });
            
            if (!response.ok) {
                throw new Error(`接收响应错误: ${response.status}`);
            }
            
            // 设置响应处理状态
            let aiMessage = '';
            let hasAudio = false;
            this.isAiSpeaking = true;
            
            // 获取响应流读取器
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            
            // 读取并处理响应流
            while (true) {
                const { done, value } = await reader.read();
                
                // 如果流结束，退出循环
                if (done) break;
                
                // 解码并处理数据块
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n\n');
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.substring(6));
                            
                            switch (data.type) {
                                case 'text':
                                    // 处理文本响应
                                    aiMessage += data.content;
                                    this.updateAIMessage(aiMessage);
                                    this.updateStatus('AI正在回复...');
                                    break;
                                    
                                case 'audio':
                                    // 处理音频响应
                                    this.playAudioChunk(data.content);
                                    hasAudio = true;
                                    this.updateStatus('AI正在语音回复...');
                                    break;
                                    
                                case 'transcript':
                                    console.log('语音转写:', data.content);
                                    break;
                                    
                                case 'interrupted':
                                    console.log('AI回复被打断');
                                    this.updateStatus('已打断AI回复');
                                    this.isAiSpeaking = false;
                                    return; // 提前退出
                                    
                                case 'error':
                                    console.error('服务器错误:', data.content);
                                    this.addMessage('系统', `错误: ${data.content}`, 'system');
                                    this.updateStatus('发生错误: ' + data.content);
                                    this.isAiSpeaking = false;
                                    return; // 提前退出
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
            
            // 更新状态
            this.isAiSpeaking = false;
            this.updateStatus('等待您说话');
            
        } catch (error) {
            // 忽略中断错误
            if (error.name === 'AbortError') {
                console.log('响应已被用户中断');
                return;
            }
            
            console.error('接收AI回复出错:', error);
            this.isAiSpeaking = false;
            this.updateStatus('接收回复失败: ' + error.message);
        } finally {
            // 清理中断控制器
            this.responseAbortController = null;
        }
    }
    
    /**
     * 中断当前AI响应
     */
    interruptAIResponse() {
        if (!this.isAiSpeaking || !this.sessionId) return;
        
        console.log('正在打断AI回复...');
        
        // 1. 中断当前的响应流
        if (this.responseAbortController) {
            this.responseAbortController.abort();
            this.responseAbortController = null;
        }
        
        // 2. 通知服务器打断
        fetch('/api/call/interrupt', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ session_id: this.sessionId })
        }).catch(error => {
            console.error('发送打断信号失败:', error);
        });
        
        // 3. 更新状态
        this.isAiSpeaking = false;
        this.updateStatus('用户打断了AI');
    }
    
    /**
     * 中断当前响应（不发送到服务器）
     */
    abortCurrentResponse() {
        if (this.responseAbortController) {
            this.responseAbortController.abort();
            this.responseAbortController = null;
        }
        this.isAiSpeaking = false;
    }
    
    /**
     * 播放音频数据块
     */
    playAudioChunk(base64Data) {
        try {
            // 清理base64前缀
            const base64Audio = base64Data.replace(/^data:audio\/[^;]+;base64,/, '');
            
            // 解码base64
            const audioData = atob(base64Audio);
            
            // 转换为Uint8Array
            const uint8Array = new Uint8Array(audioData.length);
            for (let i = 0; i < audioData.length; i++) {
                uint8Array[i] = audioData.charCodeAt(i);
            }
            
            // 创建Blob和临时URL
            const blob = new Blob([uint8Array], { type: 'audio/wav' });
            const audioUrl = URL.createObjectURL(blob);
            
            // 创建并播放音频
            const audio = new Audio(audioUrl);
            audio.onended = () => URL.revokeObjectURL(audioUrl);
            audio.play().catch(err => console.error('播放音频失败:', err));
            
        } catch (error) {
            console.error('处理音频数据失败:', error);
        }
    }
    
    /**
     * 更新AI回复消息（流式）
     */
    updateAIMessage(message) {
        // 查找或创建消息元素
        let aiMessageElem = document.getElementById('current-ai-message');
        
        if (!aiMessageElem) {
            aiMessageElem = document.createElement('div');
            aiMessageElem.id = 'current-ai-message';
            aiMessageElem.className = 'message ai';
            
            const chatMessages = document.getElementById('chat-messages');
            if (chatMessages) {
                chatMessages.appendChild(aiMessageElem);
                
                // 滚动到底部
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
        }
        
        // 更新内容
        aiMessageElem.textContent = message;
    }
    
    /**
     * 完成AI消息
     */
    completeAIMessage(message, hadAudio = false) {
        // 移除临时ID
        const aiMessageElem = document.getElementById('current-ai-message');
        if (aiMessageElem) {
            aiMessageElem.id = '';
        }
        
        // 添加完整消息
        let displayMsg = message;
        if (hadAudio) {
            displayMsg += ' [语音已播放]';
        }
        this.addMessage('AI', displayMsg, 'ai');
    }
    
    /**
     * 添加消息到聊天界面
     */
    addMessage(sender, content, type = 'user') {
        const chatMessages = document.getElementById('chat-messages');
        if (!chatMessages) return;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        
        if (type === 'system') {
            // 系统消息格式
            messageDiv.classList.add('system-message');
            messageDiv.textContent = content;
        } else {
            // 用户/AI消息格式
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
        
        // 滚动到底部
        chatMessages.scrollTop = chatMessages.scrollHeight;
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
     * 更新状态消息
     */
    updateStatus(message) {
        const statusMessage = document.getElementById('status-message');
        if (statusMessage) {
            statusMessage.textContent = message;
        }
    }
    
    /**
     * 更新UI为通话开始状态
     */
    updateUIForCallStart() {
        // 禁用开始按钮，启用结束按钮
        document.getElementById('start-call').disabled = true;
        document.getElementById('end-call').disabled = false;
    }
    
    /**
     * 更新UI为通话结束状态
     */
    updateUIForCallEnd() {
        // 启用开始按钮，禁用结束按钮
        document.getElementById('start-call').disabled = false;
        document.getElementById('end-call').disabled = true;
        
        // 移除录音状态
        const voiceButton = document.getElementById('voice-button');
        if (voiceButton) voiceButton.classList.remove('recording');
        
        const indicator = document.getElementById('recording-indicator');
        if (indicator) indicator.classList.remove('active');
    }
    
    /**
     * 清理音频资源
     */
    async cleanupAudio() {
        console.log("正在清理音频资源...");
        
        // 清理媒体录制器
        if (this.mediaRecorder) {
            try {
                if (this.mediaRecorder.state === 'recording') {
                    this.mediaRecorder.stop();
                }
            } catch (e) {
                console.warn("停止录音时出错:", e);
            }
            this.mediaRecorder = null;
        }
        
        // 停止并释放所有媒体轨道
        if (this.mediaStream) {
            try {
                const tracks = this.mediaStream.getTracks();
                tracks.forEach(track => {
                    track.stop();
                });
                this.mediaStream = null;
                console.log("媒体轨道已停止");
            } catch (e) {
                console.warn("停止媒体轨道时出错:", e);
            }
        }
        
        // 关闭音频上下文
        if (this.audioContext) {
            try {
                await this.audioContext.close();
                this.audioContext = null;
                console.log("音频上下文已关闭");
            } catch (e) {
                console.warn("关闭音频上下文时出错:", e);
            }
        }
        
        // 清空音频数据
        this.audioChunks = [];
    }
}

// 在页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    // 创建语音通话实例
    window.voiceChat = new VoiceChat();
    
    // 绑定按钮事件
    const startCallBtn = document.getElementById('start-call');
    const endCallBtn = document.getElementById('end-call');
    
    if (startCallBtn) {
        startCallBtn.addEventListener('click', () => {
            if (window.voiceChat) window.voiceChat.startCall();
        });
    }
    
    if (endCallBtn) {
        endCallBtn.addEventListener('click', () => {
            if (window.voiceChat) window.voiceChat.endCall();
        });
    }
    
    // 页面卸载时自动结束通话
    window.addEventListener('beforeunload', () => {
        if (window.voiceChat && window.voiceChat.isCallActive) {
            window.voiceChat.endCall();
        }
    });
    
    console.log("语音通话模块已加载并绑定事件");
});
