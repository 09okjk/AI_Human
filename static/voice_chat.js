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
        this.mediaStream = null; // 保存媒体流引用以便清理
        
        // 互斥锁，防止操作冲突
        this.isProcessingAudio = false;
        
        // VAD相关
        this.vadProcessor = null;
        this.userIsSpeaking = false;
        this.speechEnergy = 0;
        this.energyThreshold = 0.015; // 增加阈值，减少误触发
        this.vadAnimationFrame = null; // 保存VAD动画帧引用
        
        // 超时保护
        this.recordingTimeout = null;
        this.MAX_RECORDING_TIME = 30000; // 最长录音30秒
        
        console.log("语音通话模块已初始化");
    }
    
    async startCall() {
        try {
            // 防止重复启动
            if (this.isCallActive) {
                console.log("通话已经处于活跃状态");
                return;
            }
            
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
            document.getElementById('status-message').textContent = '通话已开始，请说话';
            document.getElementById('start-call').disabled = true;
            document.getElementById('end-call').disabled = false;
            
            // 设置状态
            this.isCallActive = true;
            
            // 初始化音频
            await this.initAudio();
            
            // 开始录音
            this.startRecording();
            
            // 添加通话开始消息到聊天界面
            this.addMessage('系统', '通话已开始，您可以开始说话', 'system');
            
        } catch (error) {
            console.error('启动通话失败:', error);
            document.getElementById('status-message').textContent = '通话启动失败: ' + error.message;
            
            // 重置按钮状态
            document.getElementById('start-call').disabled = false;
            document.getElementById('end-call').disabled = true;
        }
    }
    
    async endCall() {
        if (!this.isCallActive) return;
        
        try {
            console.log("结束通话，正在清理资源...");
            
            // 更新状态标志（在清理资源前）
            this.isCallActive = false;
            
            // 停止所有计时器
            clearTimeout(this.silenceTimer);
            clearTimeout(this.recordingTimeout);
            
            // 停止VAD检测
            if (this.vadAnimationFrame) {
                cancelAnimationFrame(this.vadAnimationFrame);
                this.vadAnimationFrame = null;
            }
            
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
                try {
                    await fetch('/api/call/end', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            session_id: this.sessionId
                        })
                    });
                } catch (err) {
                    console.error("通知服务器结束通话失败", err);
                    // 继续清理客户端资源
                }
            }
            
            // 清理状态
            this.sessionId = null;
            this.isAiSpeaking = false;
            
            // 清理音频资源
            await this.cleanupAudio();
            
            // 更新UI
            document.getElementById('start-call').disabled = false;
            document.getElementById('end-call').disabled = true;
            document.getElementById('status-message').textContent = '通话已结束';
            
            const voiceButton = document.getElementById('voice-button');
            if (voiceButton) voiceButton.classList.remove('recording');
            
            const indicator = document.getElementById('recording-indicator');
            if (indicator) indicator.classList.remove('active');
            
            // 添加通话结束消息
            this.addMessage('系统', '通话已结束', 'system');
            
        } catch (error) {
            console.error('结束通话失败:', error);
            document.getElementById('status-message').textContent = '结束通话时出错: ' + error.message;
            
            // 尝试恢复正常状态
            document.getElementById('start-call').disabled = false;
            document.getElementById('end-call').disabled = true;
            this.isCallActive = false;
            this.sessionId = null;
        }
    }
    
    async initAudio() {
        try {
            // 创建音频上下文
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // 获取麦克风权限
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });
            
            // 创建MediaRecorder
            this.mediaRecorder = new MediaRecorder(this.mediaStream, {
                mimeType: 'audio/webm'
            });
            
            // 设置事件处理
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };
            
            // 创建实时分析节点用于VAD
            const audioInput = this.audioContext.createMediaStreamSource(this.mediaStream);
            const analyser = this.audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.3; // 平滑处理，减少抖动
            audioInput.connect(analyser);
            
            // 创建处理器节点检测语音活动
            this.setupVAD(analyser);
            
            console.log("音频初始化完成");
            
        } catch (error) {
            console.error('初始化音频失败:', error);
            throw error;
        }
    }
    
    setupVAD(analyser) {
        // 创建定时器以固定间隔检测音频能量
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        // 连续检测样本计数
        let silentFrames = 0;
        let speechFrames = 0;
        
        const checkAudioEnergy = () => {
            // 检查通话是否活跃
            if (!this.isCallActive) {
                console.log("通话已结束，停止VAD检测");
                return; // 退出检测循环
            }
            
            analyser.getByteFrequencyData(dataArray);
            
            // 计算音频能量 - 只使用中低频段范围（人声主要区域）
            let sum = 0;
            const lowFreqLimit = Math.floor(bufferLength * 0.1);  // 低频限制
            const highFreqLimit = Math.floor(bufferLength * 0.7); // 高频限制
            
            for (let i = lowFreqLimit; i < highFreqLimit; i++) {
                sum += dataArray[i];
            }
            
            // 计算平均能量并归一化
            const relevantRange = highFreqLimit - lowFreqLimit;
            this.speechEnergy = sum / relevantRange / 255;
            
            const wasSpeaking = this.userIsSpeaking;
            
            // 使用滞后检测，减少误触发
            // 需要连续多帧检测到高能量才认为是说话，连续多帧低能量才认为是静音
            if (this.speechEnergy > this.energyThreshold) {
                speechFrames++;
                silentFrames = 0;
                if (speechFrames > 5) { // 需要连续5帧以上才算说话
                    this.userIsSpeaking = true;
                }
            } else {
                silentFrames++;
                speechFrames = 0;
                if (silentFrames > 15) { // 需要连续15帧以上才算静音
                    this.userIsSpeaking = false;
                }
            }
            
            // 语音状态变化处理
            if (this.userIsSpeaking !== wasSpeaking) {
                if (this.userIsSpeaking) {
                    this.handleSpeechStart();
                } else {
                    this.handleSpeechEnd();
                }
            }
            
            // 如果正在说话，更新最后说话时间
            if (this.userIsSpeaking) {
                this.lastSpeechTime = Date.now();
                document.getElementById('status-message').textContent = '正在说话...';
            } else if (!this.isProcessingAudio) {
                // 只有在没有正在处理音频的情况下才检查静音超时
                const silenceTime = Date.now() - this.lastSpeechTime;
                if (silenceTime > this.silenceThreshold && this.isRecording && this.audioChunks.length > 0) {
                    // 静音时间超过阈值，认为用户说完了
                    this.processAndSendAudio(true);
                }
            }
            
            // 更新录音指示器
            this.updateRecordingIndicator(this.userIsSpeaking);
            
            // 继续检测，保存引用以便后续取消
            this.vadAnimationFrame = requestAnimationFrame(checkAudioEnergy);
        };
        
        // 开始VAD检测
        this.vadAnimationFrame = requestAnimationFrame(checkAudioEnergy);
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
        if (!this.isRecording && this.isCallActive) {
            this.startRecording();
        }
    }
    
    handleSpeechEnd() {
        // 避免频繁启停，使用防抖动处理
        console.log('检测到停止说话');
        document.getElementById('status-message').textContent = '检测到语音停止...';
        
        // 清除之前的计时器
        clearTimeout(this.silenceTimer);
        
        // 设置新的定时器，延迟处理以避免短暂停顿被当作语音结束
        this.silenceTimer = setTimeout(() => {
            // 防止重复处理
            if (this.isRecording && !this.isProcessingAudio && this.audioChunks.length > 0 && this.isCallActive) {
                console.log("静音超过阈值，处理当前音频段");
                this.processAndSendAudio(true);
            }
        }, this.silenceThreshold);
    }
    
    startRecording() {
        if (this.isRecording || !this.isCallActive) return;
        
        // 清空之前的音频数据
        this.audioChunks = [];
        
        // 开始录音
        try {
            if (this.mediaRecorder && this.mediaRecorder.state !== 'recording') {
                this.mediaRecorder.start(100); // 每100ms触发一次ondataavailable事件
                this.isRecording = true;
                console.log('开始录音');
                
                // 更新UI
                const voiceButton = document.getElementById('voice-button');
                if (voiceButton) voiceButton.classList.add('recording');
                
                // 设置录音超时保护，防止录音时间过长
                this.recordingTimeout = setTimeout(() => {
                    console.log("录音时间超过最大限制，自动停止");
                    if (this.isRecording) {
                        this.processAndSendAudio(true);
                    }
                }, this.MAX_RECORDING_TIME);
            }
        } catch (error) {
            console.error('开始录音失败:', error);
            this.isRecording = false;
        }
    }
    
    stopRecording() {
        if (!this.isRecording) return;
        
        try {
            // 清除录音超时保护
            clearTimeout(this.recordingTimeout);
            
            if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                this.mediaRecorder.stop();
                console.log('停止录音');
                
                // 更新UI
                const voiceButton = document.getElementById('voice-button');
                if (voiceButton) voiceButton.classList.remove('recording');
            }
            
            // 必须在mediaRecorder.stop()之后更新状态
            this.isRecording = false;
        } catch (error) {
            console.error('停止录音失败:', error);
            // 确保状态一致
            this.isRecording = false;
        }
    }
    
    async processAndSendAudio(isFinal = false) {
        // 防止重复处理
        if (!this.isCallActive || this.audioChunks.length === 0 || this.isProcessingAudio) return;
        
        // 设置互斥锁
        this.isProcessingAudio = true;
        
        try {
            // 暂停录音
            this.stopRecording();
            
            document.getElementById('status-message').textContent = '处理音频数据...';
            
            // 处理音频数据
            const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
            
            // 检查音频大小，太小的音频可能只是噪音
            if (audioBlob.size < 1000) {
                console.log("音频数据太小，忽略处理", audioBlob.size);
                this.audioChunks = [];
                this.isProcessingAudio = false;
                
                // 重新开始录音
                if (this.isCallActive) {
                    setTimeout(() => this.startRecording(), 100);
                }
                return;
            }
            
            // 转换为base64
            console.log("转换音频数据为base64...");
            const base64Audio = await this.blobToBase64(audioBlob);
            
            // 发送到服务器
            console.log("发送音频数据到服务器...");
            await this.sendAudioToServer(base64Audio, isFinal);
            
            // 清空数据，准备下一段录音
            this.audioChunks = [];
            
        } catch (error) {
            console.error('处理音频失败:', error);
            document.getElementById('status-message').textContent = '处理音频失败: ' + error.message;
        } finally {
            // 释放互斥锁
            this.isProcessingAudio = false;
            
            // 如果通话仍在进行中，延迟一点再开始新的录音
            if (this.isCallActive && !this.isRecording) {
                setTimeout(() => {
                    if (this.isCallActive && !this.isRecording) {
                        this.startRecording();
                    }
                }, 300);
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
        if (!this.sessionId || !this.isCallActive) return;
        
        // 关闭之前的SSE连接
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        
        document.getElementById('status-message').textContent = '发送数据到服务器...';
        
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
            document.getElementById('status-message').textContent = '发送失败: ' + error.message;
            
            // 如果是连接错误，可能需要重试或提示用户
            if (error.message.includes('Failed to fetch')) {
                this.addMessage('系统', '连接服务器失败，请检查网络连接', 'system');
            }
        }
    }
    
    handleServerResponse() {
        // 设置新的SSE连接获取流式响应
        if (!this.sessionId || !this.isCallActive) return;
        
        this.eventSource = new EventSource(`/api/voice-chat?session_id=${this.sessionId}&_=${Date.now()}`);
        
        let aiMessage = '';
        let audioPlayed = false;
        
        this.eventSource.onmessage = (event) => {
            // 检查通话是否仍然活跃
            if (!this.isCallActive) {
                if (this.eventSource) {
                    this.eventSource.close();
                    this.eventSource = null;
                }
                return;
            }
            
            try {
                const data = JSON.parse(event.data);
                
                switch (data.type) {
                    case 'text':
                        aiMessage += data.content;
                        this.updateAIResponse(aiMessage);
                        this.isAiSpeaking = true;
                        document.getElementById('status-message').textContent = 'AI正在回复...';
                        break;
                        
                    case 'audio':
                        this.playAudioChunk(data.content);
                        audioPlayed = true;
                        this.isAiSpeaking = true;
                        document.getElementById('status-message').textContent = 'AI正在语音回复...';
                        break;
                        
                    case 'transcript':
                        console.log('语音转写:', data.content);
                        break;
                        
                    case 'interrupted':
                        console.log('AI回复被打断');
                        this.isAiSpeaking = false;
                        document.getElementById('status-message').textContent = '用户打断了AI';
                        break;
                        
                    case 'error':
                        console.error('服务器错误:', data.content);
                        this.addMessage('系统', `错误: ${data.content}`, 'system');
                        this.isAiSpeaking = false;
                        document.getElementById('status-message').textContent = '错误: ' + data.content;
                        break;
                }
            } catch (error) {
                console.error('处理服务器消息时出错:', error, event.data);
            }
        };
        
        this.eventSource.onerror = (error) => {
            console.error('SSE连接错误或关闭');
            
            // 关闭连接
            if (this.eventSource) {
                this.eventSource.close();
                this.eventSource = null;
            }
            
            // 如果有内容，完成消息
            if (aiMessage) {
                this.completeAIResponse(aiMessage, audioPlayed);
            }
            
            this.isAiSpeaking = false;
            
            // 只有在通话仍然活跃的情况下更新状态和重新开始录音
            if (this.isCallActive) {
                document.getElementById('status-message').textContent = '等待您说话';
                
                // 重新开始录音
                if (!this.isRecording && !this.isProcessingAudio) {
                    setTimeout(() => {
                        if (this.isCallActive && !this.isRecording) {
                            this.startRecording();
                        }
                    }, 300);
                }
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
            
            // 添加清理代码
            audio.onended = () => {
                URL.revokeObjectURL(audioUrl);
            };
            
            audio.play().catch(err => {
                console.error("播放音频失败:", err);
            });
            
            return audioUrl;
            
        } catch (error) {
            console.error('处理音频数据失败:', error);
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
            
            const chatMessages = document.getElementById('chat-messages');
            if (chatMessages) {
                chatMessages.appendChild(aiMessageElem);
            }
        }
        
        // 更新内容
        aiMessageElem.textContent = message;
        
        // 滚动到底部
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
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
        const chatMessages = document.getElementById('chat-messages');
        if (!chatMessages) return;
        
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
        
        chatMessages.appendChild(messageDiv);
        
        // 滚动到底部
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    
    async interruptAI() {
        if (!this.sessionId || !this.isAiSpeaking || !this.isCallActive) return;
        
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
            document.getElementById('status-message').textContent = '用户打断了AI';
            
            console.log('已发送打断信号');
            
        } catch (error) {
            console.error('发送打断信号失败:', error);
            document.getElementById('status-message').textContent = '打断失败: ' + error.message;
        }
    }
    
    async cleanupAudio() {
        console.log("正在清理音频资源...");
        
        // 清理音频资源
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
        
        // 停止所有媒体轨道
        if (this.mediaStream) {
            try {
                const tracks = this.mediaStream.getTracks();
                tracks.forEach(track => {
                    track.stop();
                    this.mediaStream.removeTrack(track);
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
                if (this.audioContext.state !== 'closed') {
                    await this.audioContext.close();
                }
                this.audioContext = null;
                console.log("音频上下文已关闭");
            } catch (e) {
                console.warn("关闭音频上下文时出错:", e);
            }
        }
        
        // 清空音频数据
        this.audioChunks = [];
        
        console.log("音频资源清理完成");
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
    
    // 页面卸载时自动结束通话
    window.addEventListener('beforeunload', () => {
        if (window.voiceChat && window.voiceChat.isCallActive) {
            window.voiceChat.endCall();
        }
    });
});
