/**
 * 实时语音通话功能 - 核心模块
 * 提供语音通话的核心功能和状态管理
 */
class VoiceChat {
    constructor() {
        // 核心状态
        this.isCallActive = false;     // 通话是否活跃
        this.isRecording = false;      // 是否正在录音
        this.isAiSpeaking = false;     // AI是否正在说话
        this.sessionId = null;         // 会话ID
        this.waitingForAiResponse = false; // 是否等待AI响应
        
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
        console.log("语音通话核心模块已初始化");
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
            const data = await this.createServerSession();
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
                await this.endServerSession();
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
     * 暂停录音 - 在检测到用户说话结束时调用
     */
    pauseRecording() {
        if (!this.isRecording || !this.mediaRecorder) return;
        
        console.log("暂停录音");
        this.isRecording = false;
        this.waitingForAiResponse = true;
        this.mediaRecorder.stop();
        
        // 停止VAD检测
        if (this.vadAnimationFrame) {
            cancelAnimationFrame(this.vadAnimationFrame);
            this.vadAnimationFrame = null;
        }
        
        this.updateStatus('正在等待AI响应...');
    }
    
    /**
     * 恢复录音 - 在收到AI第一条响应后调用
     */
    resumeRecording() {
        if (this.isRecording || !this.isCallActive || !this.mediaStream) return;
        
        console.log("恢复录音");
        this.waitingForAiResponse = false;
        this.startRecording();
        this.startVoiceDetection();
        this.updateStatus('可以继续对话');
    }
    
    /**
     * 处理用户语音结束事件
     * 当检测到用户说话结束时调用
     */
    handleUserSpeechEnd(audioBlob) {
        // 暂停录音，等待AI响应
        this.pauseRecording();
        
        // 检查音频Blob是否有效
        if (!audioBlob || audioBlob.size === 0) {
            console.error("无效的音频数据");
            this.updateStatus("录音失败，请重试");
            this.resumeRecording();
            return;
        }
        
        // 确保音频Blob的类型正确
        const audioType = audioBlob.type || 'audio/wav';
        const validatedBlob = audioBlob.type ? audioBlob : new Blob([audioBlob], { type: audioType });
        
        // 发送音频到服务器
        this.sendAudioToServer(validatedBlob)
            .then(response => {
                // 处理从服务器返回的响应
                this.handleServerResponse(response);
            })
            .catch(error => {
                console.error("发送音频失败:", error);
                this.updateStatus("发送失败，请重试");
                // 恢复录音，允许用户重试
                this.resumeRecording();
            });
    }
    
    /**
     * 将音频数据发送到服务器
     * @param {Blob} audioBlob 音频数据
     * @returns {Promise} 服务器响应
     */
    async sendAudioToServer(audioBlob) {
        if (!this.sessionId) {
            throw new Error("无效的会话ID");
        }
        
        try {
            // 转换为Base64并确保有正确的MIME类型
            const audioBase64 = await this.blobToBase64WithMimeType(audioBlob);
            
            // 准备消息结构
            const message = {
                role: "user",
                content: [{
                    type: "audio",
                    audio: audioBase64
                }]
            };
            
            const requestData = {
                session_id: this.sessionId,
                messages: [message]
            };
            
            // 发送请求
            const response = await fetch('/api/voice-chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestData)
            });
            
            if (!response.ok) {
                throw new Error(`服务器响应错误: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error("发送音频数据时出错:", error);
            throw error;
        }
    }
    
    /**
     * 将Blob对象转换为包含MIME类型的Base64字符串
     * @param {Blob} blob 音频Blob对象
     * @returns {Promise<string>} 格式为 "data:mime/type;base64,DATA" 的字符串
     */
    blobToBase64WithMimeType(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                try {
                    let base64String = reader.result;
                    
                    // 确保数据URL格式正确
                    if (!base64String.startsWith('data:')) {
                        base64String = `data:${blob.type};base64,${base64String.split(',')[1] || base64String}`;
                    }
                    
                    // 确保MIME类型存在
                    if (base64String.indexOf('data:;base64,') === 0) {
                        base64String = `data:${blob.type || 'audio/wav'};base64,${base64String.split(',')[1]}`;
                    }
                    
                    // 验证并修复Base64部分（确保长度是4的倍数）
                    const parts = base64String.split(',');
                    const header = parts[0];
                    let data = parts[1] || '';
                    
                    // 修复Base64数据长度
                    const remainder = data.length % 4;
                    if (remainder > 0) {
                        data += '='.repeat(4 - remainder);
                    }
                    
                    resolve(`${header},${data}`);
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
    
    /**
     * 处理服务器响应
     */
    handleServerResponse(response) {
        // 服务器收到第一条响应后恢复录音
        const onFirstChunk = () => {
            if (this.waitingForAiResponse) {
                this.resumeRecording();
            }
        };
        
        // 开始播放AI回复
        this.playAiResponse(response, onFirstChunk);
    }
    
    /**
     * 添加消息到聊天界面
     * @param {string} sender 发送者
     * @param {string} content 内容
     * @param {string} type 消息类型 ('user'|'ai'|'system')
     */
    addMessage(sender, content, type) {
        // 防止添加空消息或占位消息
        if (!content || content === "请说些什么，我在听。" || content === "[语音输入]") {
            return;
        }
        
        // 这里调用UI更新方法，具体实现需要根据项目UI组件修改
        // 使用事件或直接调用UI组件方法
        console.log(`添加消息: ${sender} (${type}): ${content}`);
        
        // 假设有一个消息显示函数
        if (typeof this.displayMessageInUI === 'function') {
            this.displayMessageInUI(sender, content, type);
        }
        
        // 也可以使用事件方式
        const event = new CustomEvent('voice-chat-message', {
            detail: { sender, content, type }
        });
        document.dispatchEvent(event);
    }
    
    /**
     * 更新状态显示
     */
    updateStatus(message) {
        console.log(`状态更新: ${message}`);
        // 这里只更新状态文本，不添加为消息
        // 避免状态消息被错误地显示为对话内容
        
        // 假设有一个状态更新函数
        if (typeof this.updateStatusDisplay === 'function') {
            this.updateStatusDisplay(message);
        }
        
        // 也可以使用事件方式
        const event = new CustomEvent('voice-chat-status', {
            detail: { message }
        });
        document.dispatchEvent(event);
    }
}

// 导出类
export default VoiceChat;
