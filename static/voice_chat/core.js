/**
 * 实时语音通话功能 - 核心模块
 * 提供语音通话的核心功能和状态管理
 * 基于录音对话功能，实现连续对话
 */
class VoiceChat {
    /**
     * 注入消息处理器
     */
    setMessageHandler(handler) {
        this.messageHandler = handler;
    }
    /**
     * 注入typewriter
     */
    setTypewriter(typewriter) {
        this.typewriter = typewriter;
    }
    /**
     * 注入音频流系统
     */
    setAudioSystem(audioSystem) {
        this.audioSystem = audioSystem;
    }
    /**
     * 构造函数
     */
    constructor() {
        // 核心状态
        this.isCallActive = false;     // 通话是否活跃
        this.sessionId = null;         // 会话ID
        this.waitingForAiResponse = false; // 是否等待AI响应
        this.isSpeaking = false;       // 用户是否正在说话
        
        // 语音活动检测（VAD）相关
        this.silenceTimer = null;      // 静音计时器
        this.silenceTimeout = 1800;    // 静音超时时间(ms)，1.8秒无声判定说话结束
        this.consecutiveSpeakingFrames = 0; // 连续说话帧数
        this.consecutiveSilentFrames = 0;   // 连续静音帧数
        
        // 流式回复处理相关
        this.currentMessageElement = null; // 当前消息元素
        this.textBuffer = ''; // 文本缓冲区
        this.audioChunks = []; // 音频块缓存
        this.typewriterActive = false; // 打字机效果是否激活
        this.firstResponseReceived = false; // 是否收到第一个响应
        
        // 引用录音对话功能实例
        this.audioRecorder = null;     // 录音对话功能的实例引用

        // 初始化
        console.log("语音通话核心模块已初始化");
        
        // 绑定事件处理方法
        this.handleStreamResponse = this.handleStreamResponse.bind(this);
    }
    
    /**
     * 设置录音对话实例引用
     * @param {Object} recorder - 录音对话功能的实例
     */
    setAudioRecorder(recorder) {
        if (!recorder) {
            console.error("无效的录音对话功能实例");
            return;
        }
        this.audioRecorder = recorder;
        console.log("已连接录音对话功能");
    }
    
    /**
     * 开始通话 - 创建会话并启动首次录音
     */
    async startCall() {
        try {
            // 添加调试信息
            console.log("尝试开始通话...");
            
            // 防止重复启动
            if (this.isCallActive) {
                console.log("通话已经处于活跃状态");
                return;
            }
            
            // 检查录音对话功能是否可用
            if (!this.audioRecorder) {
                console.error("录音对话功能未连接，请先调用setAudioRecorder()方法");
                this.updateStatus('错误: 录音功能未正确初始化');
                alert("录音功能未正确初始化，请刷新页面重试");
                return;
            }
            
            this.updateStatus('开始通话中...');
            
            // 1. 创建服务器会话 - 修改为正确的API端点
            console.log("正在创建服务器会话...");
            const response = await fetch('/api/call/start', {
                method: 'POST'
            });
            
            if (!response.ok) {
                throw new Error(`创建会话失败: ${response.status}`);
            }
            
            const data = await response.json();
            this.sessionId = data.session_id;
            console.log(`会话创建成功，ID: ${this.sessionId}`);
            
            // 2. 更新状态
            this.isCallActive = true;
            
            // 3. 更新UI
            this.updateUIForCallStart();
            
            // 4. 添加通话开始提示
            this.addMessage('系统', '通话已开始，您可以开始说话', 'system');
            this.updateStatus('通话已开始，请说话');
            
            // 5. 启动首次录音
            console.log("正在启动首次录音...");
            await this.startNewRecording();
            
        } catch (error) {
            console.error('启动通话失败:', error);
            this.updateStatus('通话启动失败: ' + error.message);
            this.isCallActive = false;
            this.updateUIForCallEnd();
        }
    }
    
    /**
     * 启动新的录音
     */
    async startNewRecording() {
        if (!this.isCallActive || !this.audioRecorder) return;
        
        try {
            console.log("启动新的录音");
            
            // 重置状态
            this.waitingForAiResponse = false;
            this.isSpeaking = false;
            this.consecutiveSpeakingFrames = 0;
            this.consecutiveSilentFrames = 0;
            
            // 检查录音对话功能的方法是否存在
            if (typeof this.audioRecorder.startRecording !== 'function') {
                throw new Error('录音对话功能缺少startRecording方法');
            }
            
            // 使用录音对话功能的启动录音方法
            // 我们需要覆盖原有的录音完成回调，使其自动处理连续对话
            await this.audioRecorder.startRecording(
                // 结束录音时的自定义回调
                (audioBlob) => this.handleRecordingComplete(audioBlob),
                // VAD检测的自定义回调 
                (audioLevel) => this.handleVoiceActivity(audioLevel)
            );
            
            console.log("录音已成功启动");
            this.updateStatus('您可以开始说话');
            
        } catch (error) {
            console.error("启动录音失败:", error);
            this.updateStatus('录音启动失败: ' + error.message);
            
            // 尝试重新开始录音
            setTimeout(() => {
                if (this.isCallActive && !this.waitingForAiResponse) {
                    console.log("尝试重新启动录音...");
                    this.startNewRecording();
                }
            }, 2000);
        }
    }
    
    /**
     * 处理录音完成事件
     * @param {Blob} audioBlob - 录音数据
     */
    async handleRecordingComplete(audioBlob) {
        if (!this.isCallActive || this.waitingForAiResponse) return;
        
        // 设置等待状态
        this.waitingForAiResponse = true;
        this.updateStatus("正在处理您的语音...");
        
        try {
            // 只负责转base64，不直接请求
            const base64Audio = await this.audioRecorder.blobToBase64(audioBlob);
            // 通过messageHandler流式发送和处理
            if (this.messageHandler) {
                await this.messageHandler.sendMessage('', base64Audio);
            }
            this.waitingForAiResponse = false;
        } catch (error) {
            console.error("处理录音失败:", error);
            this.updateStatus("处理失败，正在重新启动录音");
            this.waitingForAiResponse = false;
            await this.startNewRecording();
        }
    }
    
    /**
     * 处理服务器响应
     * @param {Object} response - 服务器响应
     */
    // 已委托给 messageHandler
    handleResponse(response) {
        if (!this.isCallActive) return;
        if (this.messageHandler) {
            // 让 messageHandler 处理AI回复（需适配音频流/打字机）
            this.messageHandler.handleAiResponse(response, async () => {
                if (this.isCallActive) {
                    await this.startNewRecording();
                }
            });
        }
    }
    
    /**
     * 处理语音活动检测
     * @param {number} audioLevel - 音频电平值
     */
    handleVoiceActivity(audioLevel) {
        // 设置阈值
        const speakingThreshold = 0.015;
        const silenceThreshold = 0.01;
        
        // 判断当前帧是否有语音活动
        const isSpeakingNow = audioLevel > speakingThreshold;
        const isSilentNow = audioLevel < silenceThreshold;
        
        // 更新连续帧计数
        if (isSpeakingNow) {
            this.consecutiveSpeakingFrames = (this.consecutiveSpeakingFrames || 0) + 1;
            this.consecutiveSilentFrames = 0;
            
            // 如果连续3帧以上检测到声音，判定为说话状态
            if (this.consecutiveSpeakingFrames >= 3 && !this.isSpeaking) {
                this.isSpeaking = true;
                this.updateStatus('正在说话...');
                
                // 显示录音波形
                this.updateVoiceIndicator(true, audioLevel);
                
                // 清除可能已经设置的静音定时器
                if (this.silenceTimer) {
                    clearTimeout(this.silenceTimer);
                    this.silenceTimer = null;
                }
            }
        } else if (isSilentNow && this.isSpeaking) {
            this.consecutiveSilentFrames = (this.consecutiveSilentFrames || 0) + 1;
            this.consecutiveSpeakingFrames = 0;
            
            // 开始检测静音状态
            if (this.consecutiveSilentFrames >= 15) { // 约0.3秒静音
                // 如果没有静音计时器，设置一个
                if (!this.silenceTimer) {
                    this.updateStatus('检测到语音停止，等待确认...');
                    
                    // 设置静音计时器，如果持续静音1.5秒，认为用户说话结束
                    this.silenceTimer = setTimeout(() => {
                        if (this.isCallActive && this.isSpeaking) {
                            this.isSpeaking = false;
                            this.updateStatus('检测到您已说话结束，正在处理...');
                            
                            // 更新录音波形显示
                            this.updateVoiceIndicator(false);
                            
                            // 自动停止录音并处理
                            this.autoStopAndSendRecording();
                        }
                        this.silenceTimer = null;
                    }, 1500); // 1.5秒静音阈值
                }
            }
        }
        
        // 持续更新录音指示器
        if (this.isSpeaking) {
            this.updateVoiceIndicator(true, audioLevel);
        }
    }
    
    /**
     * 更新声音波形指示器
     * @param {boolean} active - 是否显示活跃状态
     * @param {number} level - 音量级别 (0-1)
     */
    updateVoiceIndicator(active, level = 0) {
        const indicator = document.getElementById('recording-indicator');
        if (!indicator) return;
        
        if (active) {
            indicator.classList.add('active');
            
            // 创建或更新波形
            const waves = indicator.querySelectorAll('.recording-wave');
            if (waves && waves.length > 0) {
                // 根据音量调整波形高度
                const height = 6 + Math.round(level * 20);
                for (let i = 0; i < waves.length; i++) {
                    // 错开波形高度，创造波浪效果
                    const waveHeight = height * (0.7 + 0.3 * Math.sin(Date.now() / 200 + i));
                    waves[i].style.height = `${waveHeight}px`;
                }
            }
        } else {
            indicator.classList.remove('active');
        }
    }
    
    /**
     * 自动停止录音并发送
     */
    async autoStopAndSendRecording() {
        if (!this.isCallActive || !this.audioRecorder) return;
        
        try {
            console.log("自动停止录音并处理");
            
            // 停止录音并获取音频数据
            const audioBlob = await this.audioRecorder.stopRecording();
            
            if (audioBlob && audioBlob.size > 0) {
                // 设置等待状态
                this.waitingForAiResponse = true;
                this.updateStatus("正在处理您的语音...");
                // 添加用户消息到聊天界面
                this.addMessage('您', '[语音输入]', 'user');
                try {
                    // 先转base64
                    const base64Audio = await this.audioRecorder.blobToBase64(audioBlob);
                    // 通过messageHandler流式发送和处理
                    if (this.messageHandler) {
                        await this.messageHandler.sendMessage('', base64Audio);
                    }
                    this.waitingForAiResponse = false;
                    // 处理完成后，如果通话仍然活跃，开始新的录音
                    if (this.isCallActive) {
                        setTimeout(() => {
                            if (this.isCallActive) {
                                this.startNewRecording();
                            }
                        }, 800);
                    }
                } catch (error) {
                    console.error("处理录音失败:", error);
                    this.updateStatus("处理失败，正在重新启动录音");
                    this.waitingForAiResponse = false;
                    
                    // 短暂延迟后重新开始录音
                    setTimeout(() => {
                        if (this.isCallActive) {
                            this.startNewRecording();
                        }
                    }, 1000);
                }
            } else {
                console.log("没有有效的录音数据，重新开始录音");
                this.startNewRecording();
            }
        } catch (error) {
            console.error("自动处理录音失败:", error);
            this.updateStatus("录音处理失败，正在重新启动");
            
            // 短暂延迟后重新开始录音
            setTimeout(() => {
                if (this.isCallActive) {
                    this.startNewRecording();
                }
            }, 1000);
        }
    }
    
    /**
     * 处理流式响应
     * @param {Response} response - Fetch API的响应对象
     */
    async handleStreamResponse(response) {
        if (!response.ok) {
            throw new Error(`服务器错误: ${response.status}`);
        }
        
        // 创建消息元素
        if (!this.currentMessageElement) {
            this.currentMessageElement = this.createMessageElement('AI', '', 'ai');
            // 添加打字机效果容器
            this.typewriterContainer = document.createElement('div');
            this.typewriterContainer.className = 'typewriter-text';
            this.currentMessageElement.appendChild(this.typewriterContainer);
        }
        
        // 重置状态
        this.textBuffer = '';
        this.audioChunks = [];
        this.typewriterActive = false;
        this.firstResponseReceived = false;
        
        // 读取流
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const jsonStr = line.substring(5).trim();
                        const data = JSON.parse(jsonStr);
                        
                        // 根据数据类型处理
                        if (data.type === 'text' && data.content) {
                            // 文本响应
                            if (!this.firstResponseReceived) {
                                this.firstResponseReceived = true;
                                this.waitingForAiResponse = false;
                            }
                            
                            this.textBuffer += data.content;
                            this.updateTypewriterEffect(this.textBuffer);
                        } 
                        else if (data.type === 'audio' && data.content) {
                            // 音频响应
                            if (!this.firstResponseReceived) {
                                this.firstResponseReceived = true;
                                this.waitingForAiResponse = false;
                            }
                            
                            // 播放音频
                            this.playAudioChunk(data.content);
                        }
                        else if (data.type === 'transcript' && data.content) {
                            // 转录内容
                            console.log("转录:", data.content);
                            if (!this.textBuffer.startsWith('"')) {
                                this.textBuffer = `"${data.content}`;
                            } else {
                                // 追加转录内容
                                this.textBuffer += data.content;
                            }
                            this.updateTypewriterEffect(this.textBuffer);
                        }
                        else if (data.type === 'error') {
                            // 错误处理
                            console.error("服务器错误:", data.content);
                            this.updateStatus(`错误: ${data.content}`);
                            if (this.currentMessageElement) {
                                const errorSpan = document.createElement('span');
                                errorSpan.className = 'error-text';
                                errorSpan.textContent = `错误: ${data.content}`;
                                this.currentMessageElement.appendChild(errorSpan);
                            }
                        }
                    } catch (e) {
                        console.error("解析SSE数据错误:", e, line);
                    }
                }
            }
        }
        
        // 流结束处理
        if (this.textBuffer) {
            // 如果是转录消息，添加右引号
            if (this.textBuffer.startsWith('"') && !this.textBuffer.endsWith('"')) {
                this.textBuffer += '"';
                this.updateTypewriterEffect(this.textBuffer, true);
            }
            
            // 完成打字效果
            this.completeTypewriterEffect();
        }
        
        // 重置当前消息元素
        setTimeout(() => {
            this.currentMessageElement = null;
        }, 500);
        
        // 返回处理完成的文本
        return this.textBuffer;
    }
    
    /**
     * 更新打字机效果显示
     * @param {string} text - 显示的文本
     * @param {boolean} isComplete - 是否为最终文本
     */
    // 已委托给 typewriter
    updateTypewriterEffect(text, isComplete = false) {
        if (this.typewriter && typeof this.typewriter.addToTypingBuffer === 'function') {
            this.typewriter.addToTypingBuffer(text, false);
            // 这里可以根据 isComplete 调用 finalizeTypewriter
            if (isComplete && typeof this.typewriter.finalizeTypewriter === 'function') {
                this.typewriter.finalizeTypewriter();
            }
        }
    }
    
    /**
     * 完成打字机效果
     */
    // 已委托给 typewriter
    completeTypewriterEffect() {
        if (this.typewriter && typeof this.typewriter.finalizeTypewriter === 'function') {
            this.typewriter.finalizeTypewriter();
        }
    }
    
    /**
     * 滚动到最新消息
     */
    // 已委托给 messageHandler
    scrollToLatestMessage() {
        if (this.messageHandler && typeof this.messageHandler.scrollToLatestMessage === 'function') {
            this.messageHandler.scrollToLatestMessage();
        }
    }
    
    /**
     * 创建消息元素并添加到聊天容器
     * @param {string} sender - 发送者
     * @param {string} content - 消息内容 
     * @param {string} type - 消息类型
     * @returns {HTMLElement} 创建的消息元素
     */
    createMessageElement(sender, content, type) {
        const chatContainer = document.getElementById('chat-messages');
        if (!chatContainer) return null;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}-message`;
        
        if (type === 'system') {
            // 系统消息格式
            messageDiv.textContent = content;
        } else {
            // 用户/AI消息格式
            const nameSpan = document.createElement('div');
            nameSpan.className = 'message-sender';
            nameSpan.textContent = sender;
            
            messageDiv.appendChild(nameSpan);
            
            if (content) {
                const contentSpan = document.createElement('div');
                contentSpan.className = 'message-content';
                contentSpan.textContent = content;
                messageDiv.appendChild(contentSpan);
            }
        }
        
        chatContainer.appendChild(messageDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
        return messageDiv;
    }
    
    /**
     * 播放音频块
     * @param {string} base64Audio - Base64编码的音频数据
     */
    // 已委托给 audioSystem
    playAudioChunk(base64Audio) {
        if (this.audioSystem && typeof this.audioSystem.addAudioChunk === 'function') {
            this.audioSystem.addAudioChunk(base64Audio);
            return;
        }
        try {
            // 清理base64前缀
            const cleanBase64 = base64Audio.replace(/^data:audio\/[^;]+;base64,/, '');
            // 解码base64
            const binaryString = atob(cleanBase64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            // 创建Blob和临时URL
            const blob = new Blob([bytes], { type: 'audio/wav' });
            const audioUrl = URL.createObjectURL(blob);
            
            // 创建并播放音频
            const audio = new Audio(audioUrl);
            audio.onended = () => URL.revokeObjectURL(audioUrl);
            
            // 尝试播放
            audio.play().catch(err => {
                console.error('播放音频失败:', err);
                
                // 如果是自动播放策略导致的错误，尝试静音播放
                if (err.name === 'NotAllowedError') {
                    audio.muted = true;
                    audio.play().then(() => {
                        audio.muted = false;
                        audio.play().catch(e => console.error('第二次播放失败:', e));
                    }).catch(e => console.error('静音播放失败:', e));
                }
            });
            
            } catch (error) {
                console.error('处理音频数据失败:', error);
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
            this.isSpeaking = false;
            
            // 清除所有计时器
            if (this.silenceTimer) {
                clearTimeout(this.silenceTimer);
                this.silenceTimer = null;
            }
            
            // 2. 停止当前录音
            if (this.audioRecorder && typeof this.audioRecorder.stopRecording === 'function') {
                this.audioRecorder.stopRecording();
            }
            
            // 3. 取消所有计时器
            this.cancelAllTimers();
            
            // 4. 通知服务器结束会话
            if (this.sessionId) {
                await this.endServerSession();
            }
            
            // 5. 重置状态变量
            this.sessionId = null;
            this.waitingForAiResponse = false;
            
            // 6. 更新UI
            this.updateUIForCallEnd();
            this.updateStatus('通话已结束');
            
            // 7. 添加会话结束提示
            this.addMessage('系统', '通话已结束', 'system');
            
        } catch (error) {
            console.error('结束通话失败:', error);
            this.updateStatus('结束通话时出错: ' + error.message);
            this.updateUIForCallEnd();
        }
    }
    
    /**
     * 取消所有计时器
     */
    cancelAllTimers() {
        clearTimeout(this.silenceTimer);
    }
    
    /**
     * 通知服务器结束会话
     */
    async endServerSession() {
        try {
            // 修改为正确的API端点和请求格式
            await fetch('/api/call/end', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ session_id: this.sessionId })
            });
            console.log("会话已在服务器结束");
        } catch (error) {
            console.error("结束服务器会话失败:", error);
        }
    }
    
    /**
     * 添加消息到聊天界面
     */
    // 已委托给 messageHandler
    addMessage(sender, content, type) {
        if (this.messageHandler) {
            this.messageHandler.appendMessage(content, type === 'user' ? 'user' : (type === 'ai' ? 'ai' : 'system'));
        }
    }
    
    /**
     * 更新状态显示
     */
    updateStatus(message) {
        // 使用事件通知UI更新
        const event = new CustomEvent('voice-chat-status', {
            detail: { message }
        });
        document.dispatchEvent(event);
    }
    
    /**
     * 更新UI为通话开始状态
     */
    updateUIForCallStart() {
        const event = new CustomEvent('voice-chat-ui-update', {
            detail: { state: 'call-started' }
        });
        document.dispatchEvent(event);
    }
    
    /**
     * 更新UI为通话结束状态
     */
    updateUIForCallEnd() {
        const event = new CustomEvent('voice-chat-ui-update', {
            detail: { state: 'call-ended' }
        });
        document.dispatchEvent(event);
    }

    /**
     * 添加初始化检查方法，验证所有依赖是否正确设置
     */
    checkInitialization() {
        console.log("检查初始化状态...");
        
        if (!this.audioRecorder) {
            console.error("录音对话功能未连接");
            return false;
        }
        
        // 检查必要的方法
        const requiredMethods = [
            'startRecording', 
            'stopRecording', 
            'processAudioAndSend',
            'handleResponse'
        ];
        
        const missingMethods = requiredMethods.filter(
            method => typeof this.audioRecorder[method] !== 'function'
        );
        
        if (missingMethods.length > 0) {
            console.error(`录音对话功能缺少以下方法: ${missingMethods.join(', ')}`);
            return false;
        }
        
        console.log("初始化检查通过，所有依赖正确设置");
        return true;
    }
}

// 导出类
export default VoiceChat;
