/**
 * 实时语音通话功能
 */
class VoiceChat {
    constructor() {
        // 状态变量
        this.isCallActive = false;
        this.isRecording = false;
        this.isAiSpeaking = false;
        this.sessionId = null;
        this.audioContext = null;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.silenceTimer = null;
        this.silenceThreshold = 2000; // 静音2秒认为用户说完了
        this.lastSpeechTime = Date.now();
        this.eventSource = null;
        
        // VAD相关
        this.vadProcessor = null;
        this.userIsSpeaking = false;
        this.speechEnergy = 0;
        this.energyThreshold = 0.01; // 能量阈值，需要根据实际情况调整
        
        // 初始化UI元素
        this.initUIElements();
        // 绑定事件处理
        this.bindEvents();
    }
    
    initUIElements() {
        // 创建UI元素
        this.callBtn = document.getElementById('callBtn') || this.createButton('开始通话', 'callBtn');
        this.endCallBtn = document.getElementById('endCallBtn') || this.createButton('结束通话', 'endCallBtn', false);
        this.statusIndicator = document.getElementById('statusIndicator') || this.createStatusIndicator();
        this.chatBox = document.getElementById('chatBox') || this.createChatBox();
        
        // 添加到页面
        if (!document.getElementById('callBtn')) {
            const container = document.createElement('div');
            container.className = 'voice-call-container';
            container.appendChild(this.statusIndicator);
            container.appendChild(this.callBtn);
            container.appendChild(this.endCallBtn);
            document.body.appendChild(container);
            document.body.appendChild(this.chatBox);
        }
    }
    
    createButton(text, id, enabled = true) {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.id = id;
        btn.disabled = !enabled;
        return btn;
    }
    
    createStatusIndicator() {
        const div = document.createElement('div');
        div.id = 'statusIndicator';
        div.className = 'status-indicator';
        div.textContent = '准备就绪';
        return div;
    }
    
    createChatBox() {
        const div = document.createElement('div');
        div.id = 'chatBox';
        div.className = 'chat-box';
        return div;
    }
    
    bindEvents() {
        this.callBtn.addEventListener('click', () => this.startCall());
        this.endCallBtn.addEventListener('click', () => this.endCall());
        
        // 监听页面关闭事件
        window.addEventListener('beforeunload', () => {
            if (this.isCallActive) {
                this.endCall();
            }
        });
    }
    
    async startCall() {
        try {
            // 请求启动通话会话
            const response = await fetch('/api/call/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            
            const data = await response.json();
            this.sessionId = data.session_id;
            
            // 更新UI
            this.callBtn.disabled = true;
            this.endCallBtn.disabled = false;
            this.statusIndicator.textContent = '通话已开始，请说话';
            this.statusIndicator.className = 'status-indicator active';
            
            // 设置状态
            this.isCallActive = true;
            
            // 初始化音频
            await this.initAudio();
            
            // 开始录音
            this.startRecording();
            
            // 添加通话开始消息
            this.addMessage('系统', '通话已开始，您可以开始说话', 'system');
            
        } catch (error) {
            console.error('启动通话失败:', error);
            this.statusIndicator.textContent = '通话启动失败';
            this.statusIndicator.className = 'status-indicator error';
        }
    }
    
    async endCall() {
        if (!this.isCallActive) return;
        
        try {
            // 停止录音
            if (this.isRecording) {
                this.stopRecording();
            }
            
            // 关闭SSE连接
            if (this.eventSource) {
                this.eventSource.close();
                this.eventSource = null;
            }
            
            // 通知服务器结束通话
            if (this.sessionId) {
                await fetch('/api/call/end', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        session_id: this.sessionId
                    })
                });
            }
            
            // 更新状态
            this.isCallActive = false;
            this.sessionId = null;
            
            // 更新UI
            this.callBtn.disabled = false;
            this.endCallBtn.disabled = true;
            this.statusIndicator.textContent = '通话已结束';
            this.statusIndicator.className = 'status-indicator';
            
            // 清理音频资源
            this.cleanupAudio();
            
            // 添加通话结束消息
            this.addMessage('系统', '通话已结束', 'system');
            
        } catch (error) {
            console.error('结束通话失败:', error);
        }
    }
    
    async initAudio() {
        try {
            // 创建音频上下文
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // 获取麦克风权限
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // 创建MediaRecorder
            this.mediaRecorder = new MediaRecorder(stream);
            
            // 设置事件处理
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };
            
            // 创建实时分析节点用于VAD
            const audioInput = this.audioContext.createMediaStreamSource(stream);
            const analyser = this.audioContext.createAnalyser();
            analyser.fftSize = 256;
            audioInput.connect(analyser);
            
            // 创建处理器节点检测语音活动
            this.setupVAD(analyser);
            
        } catch (error) {
            console.error('初始化音频失败:', error);
            throw error;
        }
    }
    
    setupVAD(analyser) {
        // 创建定时器以固定间隔检测音频能量
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        const checkAudioEnergy = () => {
            if (!this.isCallActive) return;
            
            analyser.getByteFrequencyData(dataArray);
            
            // 计算音频能量
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
            }
            this.speechEnergy = sum / bufferLength / 255; // 归一化能量值 (0-1)
            
            const wasSpeaking = this.userIsSpeaking;
            // 检测是否正在说话
            this.userIsSpeaking = this.speechEnergy > this.energyThreshold;
            
            // 语音状态变化处理
            if (this.userIsSpeaking && !wasSpeaking) {
                // 用户开始说话
                this.handleSpeechStart();
            } else if (!this.userIsSpeaking && wasSpeaking) {
                // 用户停止说话
                this.handleSpeechEnd();
            }
            
            // 如果正在说话，更新最后说话时间
            if (this.userIsSpeaking) {
                this.lastSpeechTime = Date.now();
                this.updateUIForSpeaking();
            } else {
                const silenceTime = Date.now() - this.lastSpeechTime;
                if (silenceTime > this.silenceThreshold && this.isRecording && this.audioChunks.length > 0) {
                    // 静音时间超过阈值，认为用户说完了
                    this.processAndSendAudio(true);
                }
            }
            
            // 继续检测
            requestAnimationFrame(checkAudioEnergy);
        };
        
        // 开始VAD检测
        checkAudioEnergy();
    }
    
    handleSpeechStart() {
        console.log('检测到开始说话');
        clearTimeout(this.silenceTimer);
        
        // 如果AI正在说话，发送打断信号
        if (this.isAiSpeaking && this.sessionId) {
            this.interruptAI();
        }
        
        // 确保开始录音
        if (!this.isRecording) {
            this.startRecording();
        }
    }
    
    handleSpeechEnd() {
        console.log('检测到停止说话');
        
        // 设置定时器，延迟处理以避免短暂停顿被当作语音结束
        this.silenceTimer = setTimeout(() => {
            if (this.isRecording && this.audioChunks.length > 0) {
                // 用户短时间内没有继续说话，处理当前音频
                this.processAndSendAudio(true);
            }
        }, this.silenceThreshold);
    }
    
    updateUIForSpeaking() {
        if (this.userIsSpeaking) {
            this.statusIndicator.textContent = '正在说话...';
            this.statusIndicator.className = 'status-indicator speaking';
        } else if (this.isAiSpeaking) {
            this.statusIndicator.textContent = 'AI正在回复...';
            this.statusIndicator.className = 'status-indicator ai-speaking';
        } else {
            this.statusIndicator.textContent = '等待您说话';
            this.statusIndicator.className = 'status-indicator active';
        }
    }
    
    startRecording() {
        if (this.isRecording) return;
        
        // 清空之前的音频数据
        this.audioChunks = [];
        
        // 开始录音
        try {
            this.mediaRecorder.start(100); // 每100ms触发一次ondataavailable事件
            this.isRecording = true;
            console.log('开始录音');
            
            // 更新UI
            this.updateUIForSpeaking();
            
        } catch (error) {
            console.error('开始录音失败:', error);
        }
    }
    
    stopRecording() {
        if (!this.isRecording) return;
        
        try {
            this.mediaRecorder.stop();
            this.isRecording = false;
            console.log('停止录音');
            
        } catch (error) {
            console.error('停止录音失败:', error);
        }
    }
    
    async processAndSendAudio(isFinal = false) {
        if (!this.isCallActive || this.audioChunks.length === 0) return;
        
        try {
            // 暂停录音
            this.stopRecording();
            
            // 处理音频数据
            const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
            
            // 转换为base64
            const base64Audio = await this.blobToBase64(audioBlob);
            
            // 发送到服务器
            this.sendAudioToServer(base64Audio, isFinal);
            
            // 清空数据，准备下一段录音
            this.audioChunks = [];
            
            // 如果不是最终部分，立即开始新一轮录音
            if (!isFinal) {
                this.startRecording();
            }
            
        } catch (error) {
            console.error('处理音频失败:', error);
            
            // 重新开始录音
            this.startRecording();
        }
    }
    
    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                resolve(reader.result);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
    
    sendAudioToServer(audioData, isFinal) {
        if (!this.sessionId) return;
        
        // 关闭之前的SSE连接
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        
        // 准备请求数据
        const requestData = {
            audio: audioData,
            is_final: isFinal,
            session_id: this.sessionId,
            vad_status: {
                energy: this.speechEnergy,
                is_speaking: this.userIsSpeaking
            }
        };
        
        // 发送请求并处理流式响应
        this.eventSource = new EventSource(`/api/voice-chat?_=${Date.now()}`);
        
        // 发送POST请求
        fetch('/api/voice-chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        }).catch(error => {
            console.error('发送音频失败:', error);
        });
        
        // 处理SSE响应
        this.handleServerResponse();
        
        // 如果是最终部分，添加用户消息到UI
        if (isFinal) {
            this.addMessage('您', '[语音输入]', 'user');
        }
    }
    
    handleServerResponse() {
        if (!this.eventSource) return;
        
        let aiMessage = '';
        let audioUrls = [];
        
        this.eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            switch (data.type) {
                case 'text':
                    aiMessage += data.content;
                    this.updateAIResponse(aiMessage);
                    this.isAiSpeaking = true;
                    this.updateUIForSpeaking();
                    break;
                    
                case 'audio':
                    const audioUrl = this.playAudioChunk(data.content);
                    if (audioUrl) audioUrls.push(audioUrl);
                    this.isAiSpeaking = true;
                    this.updateUIForSpeaking();
                    break;
                    
                case 'transcript':
                    console.log('转写结果:', data.content);
                    break;
                    
                case 'interrupted':
                    console.log('AI回复被打断');
                    this.isAiSpeaking = false;
                    this.updateUIForSpeaking();
                    break;
                    
                case 'error':
                    console.error('服务器错误:', data.content);
                    this.addMessage('系统', `错误: ${data.content}`, 'error');
                    this.isAiSpeaking = false;
                    this.updateUIForSpeaking();
                    break;
            }
        };
        
        this.eventSource.onerror = (error) => {
            console.error('SSE连接错误:', error);
            this.eventSource.close();
            this.eventSource = null;
            
            // 完成当前消息
            if (aiMessage) {
                this.completeAIResponse(aiMessage, audioUrls);
            }
            
            this.isAiSpeaking = false;
            this.updateUIForSpeaking();
            
            // 重新开始录音
            this.startRecording();
        };
    }
    
    playAudioChunk(base64Data) {
        try {
            // 去掉前缀
            const base64Audio = base64Data.replace(/^data:audio\/[^;]+;base64,/, '');
            const audioData = atob(base64Audio);
            
            // 转换为Uint8Array
            const arrayBuffer = new ArrayBuffer(audioData.length);
            const uint8Array = new Uint8Array(arrayBuffer);
            for (let i = 0; i < audioData.length; i++) {
                uint8Array[i] = audioData.charCodeAt(i);
            }
            
            // 创建Blob
            const blob = new Blob([uint8Array], { type: 'audio/wav' });
            const audioUrl = URL.createObjectURL(blob);
            
            // 播放音频
            const audio = new Audio(audioUrl);
            audio.play();
            
            return audioUrl;
            
        } catch (error) {
            console.error('播放音频失败:', error);
            return null;
        }
    }
    
    updateAIResponse(message) {
        // 查找或创建AI回复消息元素
        let aiMessageElem = document.getElementById('current-ai-message');
        if (!aiMessageElem) {
            aiMessageElem = document.createElement('div');
            aiMessageElem.id = 'current-ai-message';
            aiMessageElem.className = 'message ai-message';
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'message-name';
            nameSpan.textContent = 'AI';
            
            const contentSpan = document.createElement('span');
            contentSpan.className = 'message-content';
            contentSpan.id = 'current-ai-content';
            
            aiMessageElem.appendChild(nameSpan);
            aiMessageElem.appendChild(contentSpan);
            this.chatBox.appendChild(aiMessageElem);
        }
        
        // 更新内容
        const contentElem = document.getElementById('current-ai-content');
        if (contentElem) {
            contentElem.textContent = message;
            
            // 滚动到底部
            this.chatBox.scrollTop = this.chatBox.scrollHeight;
        }
    }
    
    completeAIResponse(message, audioUrls = []) {
        // 移除临时消息ID
        const aiMessageElem = document.getElementById('current-ai-message');
        if (aiMessageElem) {
            aiMessageElem.id = '';
        }
        
        // 完整添加消息
        this.addMessage('AI', message, 'ai');
    }
    
    addMessage(sender, content, type = 'user') {
        const messageElem = document.createElement('div');
        messageElem.className = `message ${type}-message`;
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'message-name';
        nameSpan.textContent = sender;
        
        const contentSpan = document.createElement('span');
        contentSpan.className = 'message-content';
        contentSpan.textContent = content;
        
        messageElem.appendChild(nameSpan);
        messageElem.appendChild(contentSpan);
        this.chatBox.appendChild(messageElem);
        
        // 滚动到底部
        this.chatBox.scrollTop = this.chatBox.scrollHeight;
    }
    
    async interruptAI() {
        if (!this.sessionId || !this.isAiSpeaking) return;
        
        try {
            // 发送打断信号
            await fetch('/api/call/interrupt', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    session_id: this.sessionId
                })
            });
            
            // 关闭当前的SSE连接
            if (this.eventSource) {
                this.eventSource.close();
                this.eventSource = null;
            }
            
            // 更新状态
            this.isAiSpeaking = false;
            this.updateUIForSpeaking();
            
            console.log('已发送打断信号');
            
        } catch (error) {
            console.error('发送打断信号失败:', error);
        }
    }
    
    cleanupAudio() {
        // 清理音频资源
        if (this.mediaRecorder && this.mediaRecorder.stream) {
            const tracks = this.mediaRecorder.stream.getTracks();
            tracks.forEach(track => track.stop());
        }
        
        this.mediaRecorder = null;
        
        // 清理音频上下文
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }
}

// 等待DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    window.voiceChat = new VoiceChat();
});
