/**
 * AI Human - 主应用入口文件
 * 集成所有模块并初始化应用
 */

document.addEventListener('DOMContentLoaded', () => {
    // DOM元素引用
    const elements = {
        chatMessages: document.getElementById('chat-messages'),
        textInput: document.getElementById('text-input'),
        voiceButton: document.getElementById('voice-button'),
        sendButton: document.getElementById('send-button'),
        recordingIndicator: document.getElementById('recording-indicator'),
        statusMessage: document.getElementById('status-message')
    };
    
    // 音频上下文
    let audioContext;
    
    // 模块加载与初始化
    const initializeApp = async () => {
        try {
            // 1. 加载模块 (使用IIFE动态模块加载)
            const { 
                typewriterSystem, 
                audioRecorder, 
                audioStreamingSystem,
                messageHandler 
            } = await loadModules();
            
            console.log("模块加载成功");
            
            // 2. 初始化音频上下文
            const initAudioContext = async () => {
                try {
                    audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    audioStreamingSystem.init(audioContext);
                    elements.statusMessage.textContent = "音频系统已初始化";
                    return audioContext;
                } catch (error) {
                    console.error("初始化音频上下文出错:", error);
                    elements.statusMessage.textContent = "音频系统初始化失败";
                    return null;
                }
            };
            
            // 3. 设置事件监听器
            // 语音按钮
            elements.voiceButton.addEventListener('click', async () => {
                // 确保音频上下文已初始化
                if (!audioContext) {
                    audioContext = await initAudioContext();
                    if (!audioContext) return;
                }
                
                if (audioRecorder.getIsRecording()) {
                    // 如果正在录音，停止并发送
                    const audioData = await audioRecorder.stopRecording();
                    if (audioData) {
                        // 更新UI
                        elements.voiceButton.classList.remove('recording');
                        elements.recordingIndicator.classList.remove('active');
                        // 发送音频消息
                        messageHandler.sendMessage('', audioData);
                    }
                } else {
                    // 开始录音
                    const success = await audioRecorder.startRecording(audioContext);
                    if (success) {
                        // 更新UI
                        elements.voiceButton.classList.add('recording');
                        elements.recordingIndicator.classList.add('active');
                    }
                }
            });
            
            // 文本发送按钮事件
            elements.sendButton.addEventListener('click', () => {
                const text = elements.textInput.value.trim();
                if (text) {
                    messageHandler.sendMessage(text);
                    elements.textInput.value = '';
                }
            });
            
            // 输入框回车键事件
            elements.textInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const text = elements.textInput.value.trim();
                    if (text) {
                        messageHandler.sendMessage(text);
                        elements.textInput.value = '';
                    }
                }
            });
            
            // 初始时自动初始化音频上下文 (一次性点击事件)
            document.body.addEventListener('click', async () => {
                if (!audioContext) {
                    audioContext = await initAudioContext();
                }
            }, { once: true });
            
        } catch (error) {
            console.error("应用初始化失败:", error);
            elements.statusMessage.textContent = "应用初始化失败，请检查控制台";
        }
    };
    
    // 动态加载所有模块
    const loadModules = async () => {
        try {
            // 尝试动态导入模块
            const [
                typewriterModule,
                audioRecorderModule,
                audioStreamingModule,
                messageHandlerModule
            ] = await Promise.all([
                import('./js/typewriter.js').catch(e => console.error("加载typewriter.js失败:", e)),
                import('./js/audio-recorder.js').catch(e => console.error("加载audio-recorder.js失败:", e)),
                import('./js/audio-streaming.js').catch(e => console.error("加载audio-streaming.js失败:", e)),
                import('./js/message-handler.js').catch(e => console.error("加载message-handler.js失败:", e))
            ]);
            
            // 创建各模块实例
            const typewriterSystem = typewriterModule?.default;
            const audioRecorder = audioRecorderModule?.default ? new audioRecorderModule.default(elements.statusMessage) : null;
            const audioStreamingSystem = audioStreamingModule?.default ? new audioStreamingModule.default(elements.statusMessage) : null;
            
            // 消息处理器需要其他模块的支持
            const messageHandler = messageHandlerModule?.default ? new messageHandlerModule.default(
                {
                    chatMessages: elements.chatMessages,
                    statusElement: elements.statusMessage
                },
                typewriterSystem,
                audioStreamingSystem
            ) : null;
            
            // 返回所有模块
            return {
                typewriterSystem,
                audioRecorder,
                audioStreamingSystem,
                messageHandler
            };
        } catch (error) {
            console.error("加载模块失败:", error);
            elements.statusMessage.textContent = "加载组件失败，请检查控制台";
            
            // 作为回退方案，尝试从window全局对象获取模块
            // 这需要在HTML中通过传统脚本标签加载模块
            return {
                typewriterSystem: window.TypewriterSystem,
                audioRecorder: window.AudioRecorder ? new window.AudioRecorder(elements.statusMessage) : null,
                audioStreamingSystem: window.AudioStreamingSystem ? new window.AudioStreamingSystem(elements.statusMessage) : null,
                messageHandler: window.MessageHandler ? new window.MessageHandler(
                    {
                        chatMessages: elements.chatMessages,
                        statusElement: elements.statusMessage
                    },
                    window.TypewriterSystem,
                    window.AudioStreamingSystem ? new window.AudioStreamingSystem(elements.statusMessage) : null
                ) : null
            };
        }
    };
    
    // 启动应用
    initializeApp();
});

/**
 * 如果您的浏览器不支持ES模块，您可以使用下面的脚本标签方式引入所需模块
 * 将下面代码添加到您的HTML文件中：
 *
 * <script src="./js/typewriter.js"></script>
 * <script src="./js/audio-recorder.js"></script>
 * <script src="./js/audio-streaming.js"></script>
 * <script src="./js/message-handler.js"></script>
 * <script src="./app.js"></script>
 */

// 通话控制功能
document.addEventListener('DOMContentLoaded', function() {
    const startCallButton = document.getElementById('start-call');
    const endCallButton = document.getElementById('end-call');
    const statusMessage = document.getElementById('status-message');
    
    // 如果已加载语音通话模块，则连接按钮与该功能
    startCallButton.addEventListener('click', function() {
        if (window.voiceChat) {
            window.voiceChat.startCall();
            startCallButton.disabled = true;
            endCallButton.disabled = false;
            statusMessage.textContent = '通话已开始，请说话';
        } else {
            statusMessage.textContent = '语音通话模块未加载';
        }
    });
    
    endCallButton.addEventListener('click', function() {
        if (window.voiceChat) {
            window.voiceChat.endCall();
            startCallButton.disabled = false;
            endCallButton.disabled = true;
            statusMessage.textContent = '通话已结束';
        }
    });
});
