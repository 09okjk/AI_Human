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
        
        console.log("语音通话模块已初始化");
        
        // 初始化UI元素和事件处理
        this.initUI();
    }
    
    initUI() {
        // 确保通话控制按钮存在
        this.startCallBtn = document.getElementById('start-call');
        this.endCallBtn = document.getElementById('end-call');
        this.statusMessage = document.getElementById('status-message');
        this.chatMessages = document.getElementById('chat-messages');
        
        if (this.startCallBtn && this.endCallBtn) {
            console.log("找到通话控制按钮");
        } else {
            console.error("未找到通话控制按钮");
        }
    }
    
    async startCall() {
        try {
            console.log("开始通话...");
            // 请求启动通话会话
            const response = await fetch('/api/call/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            
            if (!response.ok) {
                throw new Error(`服务器错误: ${response.status}`);
            }
            
            const data = await response.json();
            this.sessionId = data.session_id;
            
            // 更新UI
            if (this.statusMessage) this.statusMessage.textContent = '通话已开始，请说话';
            if (this.startCallBtn) this.startCallBtn.disabled = true;
            if (this.endCallBtn) this.endCallBtn.disabled = false;
            
            // 设置状态
            this.isCallActive = true;
            
            // 初始化音频
            await this.initAudio();
            
            // 开始录音
            this.startRecording();
            
            this.addMessage('系统', '通话已开始，您可以开始说话');
            
        } catch (error) {
            console.error('启动通话失败:', error);
            if (this.statusMessage) this.statusMessage.textContent = '通话启动失败: ' + error.message;
            
            // 重置按钮状态
            if (this.startCallBtn) this.startCallBtn.disabled = false;
            if (this.endCallBtn) this.endCallBtn.disabled = true;
        }
    }
    
    async endCall() {
        if (!this.isCallActive) return;
        
        try {
            console.log("结束通话...");
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
            if (this.startCallBtn) this.startCallBtn.disabled = false;
            if (this.endCallBtn) this.endCallBtn.disabled = true;
            if (this.statusMessage) this.statusMessage.textContent = '通话已结束';
            
            // 清理音频资源
            this.cleanupAudio();
            
            this.addMessage('系统', '通话已结束');
            
        } catch (error) {
            console.error('结束通话失败:', error);
            if (this.statusMessage) this.statusMessage.textContent = '结束通话时出错: ' + error.message;
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
            
            this.mediaRecorder.onstop = () => {
                if (this.audioChunks.length > 0 && this.isCallActive) {
                    this.processAndSendAudio(true);
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
                if (this.statusMessage) this.statusMessage.textContent = '正在说话...';
            } else {
                const silenceTime = Date.now() - this.lastSpeechTime;
                if (silenceTime > this.silenceThreshold && this.isRecording && this.audioChunks.length > 0) {
                    // 静音时间超过阈值，认为用户说完了
                    this.processAndSendAudio(true);
                }
            }
            
            // 更新录音指示器
            this.updateRecordingIndicator(this.userIsSpeaking);
            
            // 继续检测
            requestAnimationFrame(checkAudioEnergy);
        };
        
        // 开始VAD检测
        checkAudioEnergy();
    }
    
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
        if (this.statusMessage) this.statusMessage.textContent = '检测到语音停止，处理中...';
        
        // 设置定时器，延迟处理以避免短暂停顿被当作语音结束
        this.silenceTimer = setTimeout(() => {
            if (this.isRecording && this.audioChunks.length > 0) {
                // 用户短时间内没有继续说话，处理当前音频
                this.processAndSendAudio(true);
            }
        }, this.silenceThreshold);
    }
    
    startRecording() {
        if (this.isRecording) return;
        
        // 清空之前的音频数据
        this.audioChunks = [];
        
        // 开始录音
        try {
            if (this.mediaRecorder && this.mediaRecorder.state !== 'recording') {
                this.mediaRecorder.start(100); // 每100ms触发一次ondataavailable事件
                this.isRecording = true;
                console.log('开始录音');
                
                // 更新UI
                document.getElementById('voice-button').classList.add('recording');
            }
        } catch (error) {
            console.error('开始录音失败:', error);
        }
    }
    
    stopRecording() {
        if (!this.isRecording) return;
        
        try {
            if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                this.mediaRecorder.stop();
                this.isRecording = false;
                console.log('停止录音');
                
                // 更新UI
                document.getElementById('voice-button').classList.remove('recording');
            }
        } catch (error) {
            console.error('停止录音失败:', error);
        }
    }
    
    async processAndSendAudio(isFinal = false) {
        if (!this.isCallActive || this.audioChunks.length === 0) return;
        
        try {
            // 暂停录音
            this.stopRecording();
            
            if (this.statusMessage) this.statusMessage.textContent = '处理音频数据...';
            
            // 处理音频数据
            const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
            
            // 转换为base64
            const base64Audio = await this.blobToBase64(audioBlob);
            
            // 发送到服务器
            await this.sendAudioToServer(base64Audio, isFinal);
            
            // 清空数据，准备下一段录音
            this.audioChunks = [];
            
            // 如果不是最终部分，立即开始新一轮录音
            if (!isFinal) {
                this.startRecording();
            } else if (this.isCallActive) {
                // 如果是最终部分但通话仍在进行中，延迟一点再开始新的录音
                setTimeout(() => {
                    if (this.isCallActive && !this.isRecording) {
                        this.startRecording();
                    }
                }, 500);
            }
            
        } catch (error) {
            console.error('处理音频失败:', error);
            if (this.statusMessage) this.statusMessage.textContent = '处理音频失败: ' + error.message;
            
            // 重新开始录音
            if (this.isCallActive && !this.isRecording) {
                this.startRecording();
            }
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
    
    async sendAudioToServer(audioData, isFinal) {
        if (!this.sessionId) return;
        
        // 关闭之前的SSE连接
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        
        if (this.statusMessage) this.statusMessage.textContent = '发送数据到服务器...';
        
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
        
        try {
            // 发送请求
            const response = await fetch('/api/voice-chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestData)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            // 如果是最终部分，添加用户消息到UI
            if (isFinal) {
                this.addMessage('您', '[语音输入]', 'user');
            }
            
            // 处理服务器响应流
            this.handleServerResponse();
            
        } catch (error) {
            console.error('发送音频失败:', error);
            if (this.statusMessage) this.statusMessage.textContent = '发送失败: ' + error.message;
        }
    }
    
    handleServerResponse() {
        // 设置新的SSE连接获取流式响应
        if (!this.sessionId) return;
        
        this.eventSource = new EventSource(`/api/voice-chat?session_id=${this.sessionId}&_=${Date.now()}`);
        
        let aiMessage = '';
        let audioPlayed = false;
        
        this.eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                switch (data.type) {
                    case 'text':
                        aiMessage += data.content;
                        this.updateAIResponse(aiMessage);
                        this.isAiSpeaking = true;
                        if (this.statusMessage) this.statusMessage.textContent = 'AI正在回复...';
                        break;
                        
                    case 'audio':
                        this.playAudioChunk(data.content);
                        audioPlayed = true;
                        this.isAiSpeaking = true;
                        if (this.statusMessage) this.statusMessage.textContent = 'AI正在语音回复...';
                        break;
                        
                    case 'transcript':
                        console.log('语音转写:', data.content);
                        break;
                        
                    case 'interrupted':
                        console.log('AI回复被打断');
                        this.isAiSpeaking = false;
                        if (this.statusMessage) this.statusMessage.textContent = '用户打断了AI';
                        break;
                        
                    case 'error':
                        console.error('服务器错误:', data.content);
                        this.addMessage('系统', `错误: ${data.content}`, 'system');
                        this.isAiSpeaking = false;
                        if (this.statusMessage) this.statusMessage.textContent = '错误: ' + data.content;
                        break;
                }
            } catch (error) {
                console.error('处理服务器消息时出错:', error);
            }
        };
        
        this.eventSource.onerror = (error) => {
            console.error('SSE连接错误或关闭');
            this.eventSource.close();
            this.eventSource = null;
            
            // 如果有内容，完成消息
            if (aiMessage) {
                this.completeAIResponse(aiMessage, audioPlayed);
            }
            
            this.isAiSpeaking = false;
            if (this.statusMessage) this.statusMessage.textContent = '等待您说话';
            
            // 重新开始录音
            if (this.isCallActive && !this.isRecording) {
                this.startRecording();
            }
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
            
            // 清理URL
            audio.onended = () => {
                URL.revokeObjectURL(audioUrl);
            };
            
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
            aiMessageElem.className = 'message ai';
            
            if (this.chatMessages) {
                this.chatMessages.appendChild(aiMessageElem);
            }
        }
        
        // 更新内容
        aiMessageElem.textContent = message;
        
        // 滚动到底部
        if (this.chatMessages) {
            this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        }
    }
    
    completeAIResponse(message, hadAudio = false) {
        // 移除临时消息ID
        const aiMessageElem = document.getElementById('current-ai-message');
        if (aiMessageElem) {
            aiMessageElem.id = '';
        }
        
        // 完整添加消息
        let displayMsg = message;
        if (hadAudio) {
            displayMsg += ' [语音已播放]';
        }
        this.addMessage('AI', displayMsg, 'ai');
    }
    
    addMessage(sender, content, type = 'user') {
        if (!this.chatMessages) return;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        
        if (type === 'system') {
            // 系统消息样式
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
        
        this.chatMessages.appendChild(messageDiv);
        
        // 滚动到底部
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
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
            if (this.statusMessage) this.statusMessage.textContent = '用户打断了AI';
            
            console.log('已发送打断信号');
            
        } catch (error) {
            console.error('发送打断信号失败:', error);
            if (this.statusMessage) this.statusMessage.textContent = '打断失败: ' + error.message;
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
    console.log("语音通话模块已加载完成");
    
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
});
