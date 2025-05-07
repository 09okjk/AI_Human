/**
 * 实时语音通话功能 - 核心模块
 * 提供语音通话的核心功能和状态管理
 * 基于录音对话功能，实现连续对话
 */
class VoiceChat {
    constructor() {
        // 核心状态
        this.isCallActive = false;     // 通话是否活跃
        this.sessionId = null;         // 会话ID
        this.waitingForAiResponse = false; // 是否等待AI响应
        
        // 语音活动检测（VAD）相关
        this.silenceTimer = null;      // 静音计时器
        this.silenceTimeout = 1800;    // 静音超时时间(ms)，1.8秒无声判定说话结束
        
        // 引用录音对话功能实例
        this.audioRecorder = null;     // 录音对话功能的实例引用

        // 初始化
        console.log("语音通话核心模块已初始化");
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
            
            // 1. 创建服务器会话
            console.log("正在创建服务器会话...");
            const response = await fetch('/api/voice-chat/session', {
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
            // 使用录音对话功能处理音频并发送
            const response = await this.audioRecorder.processAudioAndSend(audioBlob, this.sessionId);
            
            // 处理响应，但重写响应处理逻辑，使其完成后自动启动下一轮录音
            this.handleResponse(response);
            
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
    handleResponse(response) {
        if (!this.isCallActive) return;
        
        // 绑定onComplete回调，用于AI回复结束后自动启动下一轮录音
        const wrappedResponse = {
            ...response,
            onComplete: async () => {
                console.log("AI回复完成，准备下一轮录音");
                
                if (this.isCallActive) {
                    // 短暂延迟，让用户有时间反应
                    setTimeout(async () => {
                        if (this.isCallActive) {
                            await this.startNewRecording();
                        }
                    }, 500);
                }
                
                // 调用原始onComplete如果存在
                if (response.onComplete) {
                    response.onComplete();
                }
            }
        };
        
        // 使用录音对话功能处理响应（播放语音等）
        this.audioRecorder.handleResponse(wrappedResponse);
    }
    
    /**
     * 处理语音活动检测
     * @param {number} audioLevel - 音频电平值
     */
    handleVoiceActivity(audioLevel) {
        // 这里可以添加UI反馈，如显示声波等
        // 但核心VAD检测由录音对话功能处理
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
            await fetch(`/api/voice-chat/session/${this.sessionId}`, {
                method: 'DELETE'
            });
            console.log("会话已在服务器结束");
        } catch (error) {
            console.error("结束服务器会话失败:", error);
        }
    }
    
    /**
     * 添加消息到聊天界面
     */
    addMessage(sender, content, type) {
        // 防止添加空消息或占位消息
        if (!content || content === "请说些什么，我在听。" || content === "[语音输入]") {
            return;
        }
        
        // 使用事件通知UI更新
        const event = new CustomEvent('voice-chat-message', {
            detail: { sender, content, type }
        });
        document.dispatchEvent(event);
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
