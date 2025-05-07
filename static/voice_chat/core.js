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
}

// 导出类
export default VoiceChat;
