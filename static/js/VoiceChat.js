import AudioManager from './audio/AudioManager.js';
import VoiceDetection from './audio/VoiceDetection.js';
import MessageHandler from './ui/MessageHandler.js';
import ApiClient from './api/ApiClient.js';

/**
 * 语音通话主控制类 - 协调其他模块
 */
class VoiceChat {
    constructor() {
        // 核心状态
        this.isCallActive = false;  // 通话是否活跃
        this.isAiSpeaking = false;  // AI是否正在说话
        this.sessionId = null;      // 会话ID
        
        // 初始化模块
        this.audioManager = new AudioManager();
        this.voiceDetection = new VoiceDetection();
        this.messageHandler = new MessageHandler();
        this.apiClient = new ApiClient();
        
        console.log("语音通话模块已初始化");
    }
    
    /**
     * 开始通话
     */
    async startCall() {
        try {
            // 防止重复启动
            if (this.isCallActive) {
                console.log("通话已经处于活跃状态");
                return;
            }
            
            // 1. 更新状态
            this.messageHandler.updateStatus('开始通话中...');
            
            // 2. 创建服务器会话
            this.sessionId = await this.apiClient.createSession();
            
            // 3. 更新UI状态
            this.messageHandler.updateUIForCallStart();
            this.isCallActive = true;
            
            // 4. 初始化音频系统
            await this.audioManager.initialize();
            
            // 5. 设置录音数据处理
            this.audioManager.setupRecordingEvents();
            
            // 6. 开始语音检测
            const analyser = this.audioManager.createAnalyser();
            this.voiceDetection.start(
                analyser,
                // 用户开始说话
                () => {
                    this.handleUserSpeechStart();
                },
                // 用户停止说话
                () => {
                    this.messageHandler.updateStatus('检测到语音停止，等待中...');
                },
                // 静音超时，处理录音
                () => {
                    if (this.audioManager.isRecording) {
                        this.processRecording();
                    }
                },
                // 更新录音指示器
                (isSpeaking) => {
                    this.messageHandler.updateRecordingIndicator(isSpeaking && this.audioManager.isRecording);
                }
            );
            
            // 7. 开始录音
            this.audioManager.startRecording(() => this.processRecording());
            
            // 8. 添加通话开始提示
            this.messageHandler.addMessage('系统', '通话已开始，您可以开始说话', 'system');
            this.messageHandler.updateStatus('通话已开始，请说话');
            
        } catch (error) {
            console.error('启动通话失败:', error);
            this.messageHandler.updateStatus('通话启动失败: ' + error.message);
            this.messageHandler.updateUIForCallEnd();
        }
    }
    
    /**
     * 结束通话
     */
    async endCall() {
        if (!this.isCallActive) return;
        
        try {
            this.messageHandler.updateStatus('正在结束通话...');
            console.log("结束通话，正在清理资源...");
            
            // 1. 立即更新状态，防止后续操作
            this.isCallActive = false;
            this.isAiSpeaking = false;
            
            // 2. 停止语音检测
            this.voiceDetection.stop();
            
            // 3. 停止录音
            this.audioManager.stopRecording();
            
            // 4. 中断当前响应
            this.apiClient.abortCurrentResponse();
            
            // 5. 通知服务器结束会话
            if (this.sessionId) {
                await this.apiClient.endSession(this.sessionId);
            }
            
            // 6. 重置会话ID
            this.sessionId = null;
            
            // 7. 清理音频资源
            await this.audioManager.cleanup();
            
            // 8. 更新UI
            this.messageHandler.updateUIForCallEnd();
            this.messageHandler.updateStatus('通话已结束');
            this.messageHandler.addMessage('系统', '通话已结束', 'system');
            
        } catch (error) {
            console.error('结束通话失败:', error);
            this.messageHandler.updateStatus('结束通话时出错: ' + error.message);
            this.messageHandler.updateUIForCallEnd();
            this.isCallActive = false;
            this.sessionId = null;
        }
    }
    
    /**
     * 处理用户开始说话
     */
    handleUserSpeechStart() {
        // 如果AI正在说话，发送打断信号
        if (this.isAiSpeaking && this.sessionId) {
            this.interruptAIResponse();
        }
        
        // 确保录音已经开始
        if (!this.audioManager.isRecording && this.isCallActive) {
            this.audioManager.startRecording(() => this.processRecording());
        }
        
        // 更新UI显示
        this.messageHandler.updateStatus('正在说话...');
    }
    
    /**
     * 处理录音数据
     */
    async processRecording() {
        if (!this.isCallActive) return;
        
        try {
            // 1. 停止录音
            this.audioManager.stopRecording();
            this.messageHandler.updateStatus('处理音频中...');
            
            // 2. 获取录音数据
            const audioBlob = this.audioManager.getRecordingBlob();
            if (!audioBlob || audioBlob.size < 1000) {
                console.log("录音数据过小，跳过处理");
                this.audioManager.clearRecording();
                
                // 重新开始录音
                if (this.isCallActive) {
                    setTimeout(() => {
                        if (this.isCallActive) this.audioManager.startRecording(() => this.processRecording());
                    }, 100);
                }
                return;
            }
            
            // 3. 转换为Base64
            const base64Audio = await this.audioManager.blobToBase64(audioBlob);
            
            // 4. 发送到服务器
            this.messageHandler.updateStatus('发送音频到服务器...');
            await this.apiClient.sendAudio(
                this.sessionId, 
                base64Audio, 
                this.voiceDetection.getAudioLevel()
            );
            
            // 5. 添加用户消息
            this.messageHandler.addMessage('您', '[语音输入]', 'user');
            
            // 6. 清空录音数据
            this.audioManager.clearRecording();
            
            // 7. 接收AI回复
            await this.receiveAIResponse();
            
        } catch (error) {
            console.error('处理录音失败:', error);
            this.messageHandler.updateStatus('处理失败: ' + error.message);
            
            if (error.message.includes('Failed to fetch')) {
                this.messageHandler.addMessage('系统', '连接服务器失败，请检查网络连接', 'system');
            }
        } finally {
            // 如果通话仍在进行中，重新开始录音
            if (this.isCallActive) {
                setTimeout(() => {
                    if (this.isCallActive && !this.audioManager.isRecording) {
                        this.audioManager.startRecording(() => this.processRecording());
                    }
                }, 300);
            }
        }
    }
    
    /**
     * 接收AI响应
     */
    async receiveAIResponse() {
        if (!this.sessionId || !this.isCallActive) return;
        
        this.messageHandler.updateStatus('等待AI回复...');
        this.isAiSpeaking = true;
        
        await this.apiClient.receiveAIResponse(
            this.sessionId,
            // 文本块回调
            (textChunk, fullText) => {
                this.messageHandler.updateAIMessage(fullText);
                this.messageHandler.updateStatus('AI正在回复...');
            },
            // 音频块回调
            (audioData) => {
                this.audioManager.playAudioChunk(audioData);
                this.messageHandler.updateStatus('AI正在语音回复...');
            },
            // 转写回调
            (transcript) => {
                console.log('语音转写:', transcript);
            },
            // 打断回调
            () => {
                this.messageHandler.updateStatus('已打断AI回复');
                this.isAiSpeaking = false;
            },
            // 错误回调
            (errorMsg) => {
                this.messageHandler.addMessage('系统', `错误: ${errorMsg}`, 'system');
                this.messageHandler.updateStatus('发生错误: ' + errorMsg);
                this.isAiSpeaking = false;
            },
            // 完成回调
            (message, hadAudio) => {
                this.messageHandler.completeAIMessage(message, hadAudio);
                this.isAiSpeaking = false;
                this.messageHandler.updateStatus('等待您说话');
            }
        );
    }
    
    /**
     * 中断AI响应
     */
    interruptAIResponse() {
        if (this.isAiSpeaking && this.sessionId) {
            console.log('正在打断AI回复...');
            this.apiClient.interruptAIResponse(this.sessionId);
            this.isAiSpeaking = false;
            this.messageHandler.updateStatus('用户打断了AI');
        }
    }
}

export default VoiceChat;
