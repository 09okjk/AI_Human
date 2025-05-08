/**
 * 语音通话功能初始化脚本
 */

// 导入必要的模块
import VoiceChat from './core.js';
import '../voice_chat/inject_js_dependencies.js'; // 注入js依赖

// 等待DOM加载完成
document.addEventListener('DOMContentLoaded', () => {
    // 获取UI元素
    const startCallButton = document.getElementById('start-call');
    const endCallButton = document.getElementById('end-call');
    const statusElement = document.getElementById('status-message');
    
    // 检查并使用全局变量中已经初始化的实例
    const setupVoiceChat = () => {
        // 如果voiceChat已经在voice_chat.js中初始化，直接使用
        if (window.voiceChat && window.audioRecorder) {
            console.log("使用已初始化的语音通话实例");
            
            // 确保按钮功能正常工作
            setupButtonEvents(window.voiceChat);
            return true;
        }
        
        // 如果全局实例不可用，进行本地初始化（备选方案）
        console.log("全局语音通话实例不可用，进行本地初始化");
        
        try {
            // 获取录音对话功能实例 - 通过全局对象或动态导入
            let audioRecorder = window.audioRecorder;
            
            if (!audioRecorder) {
                if (typeof AudioRecorder !== 'undefined') {
                    audioRecorder = new AudioRecorder(statusElement);
                } else {
                    console.error("录音对话功能不可用");
                    statusElement.textContent = "录音功能不可用，请刷新页面重试";
                    return false;
                }
            }
            
            // 初始化语音通话功能
            const voiceChat = new VoiceChat();
            voiceChat.setAudioRecorder(audioRecorder);
            // 注入js/message-handler.js等依赖
            if (window.voiceChatMessageHandler && window.voiceChatTypewriter && window.voiceChatAudioSystem) {
                voiceChat.setMessageHandler(window.voiceChatMessageHandler);
                voiceChat.setTypewriter(window.voiceChatTypewriter);
                voiceChat.setAudioSystem(window.voiceChatAudioSystem);
            }
            // 保存到全局
            window.voiceChat = voiceChat;
            window.audioRecorder = audioRecorder;
            
            // 检查初始化状态
            if (!voiceChat.checkInitialization()) {
                console.error("语音通话功能初始化失败");
                statusElement.textContent = "语音通话功能初始化失败，请刷新页面重试";
                startCallButton.disabled = true;
                return false;
            }
            
            // 为按钮设置事件
            setupButtonEvents(voiceChat);
            return true;
            
        } catch (error) {
            console.error("语音通话初始化失败:", error);
            statusElement.textContent = "语音通话初始化失败，请刷新页面重试";
            startCallButton.disabled = true;
            return false;
        }
    };
    
    // 设置按钮事件
    const setupButtonEvents = (voiceChatInstance) => {
        // 绑定按钮事件
        startCallButton.addEventListener('click', async () => {
            // 禁用开始按钮，防止重复点击
            startCallButton.disabled = true;
            // 启用结束按钮
            endCallButton.disabled = false;
            
            // 开始通话
            await voiceChatInstance.startCall();
        });
        
        endCallButton.addEventListener('click', async () => {
            // 禁用结束按钮，防止重复点击
            endCallButton.disabled = true;
            // 启用开始按钮
            startCallButton.disabled = false;
            
            // 结束通话
            await voiceChatInstance.endCall();
        });
        
        // 监听状态更新事件
        document.addEventListener('voice-chat-status', (event) => {
            statusElement.textContent = event.detail.message;
        });
        
        // 监听UI更新事件
        document.addEventListener('voice-chat-ui-update', (event) => {
            if (event.detail.state === 'call-started') {
                startCallButton.disabled = true;
                endCallButton.disabled = false;
            } else if (event.detail.state === 'call-ended') {
                startCallButton.disabled = false;
                endCallButton.disabled = true;
            }
        });
    };
    
    // 确保AudioRecorder定义后再初始化
    if (document.readyState === 'complete') {
        // 如果页面已经加载完成，立即初始化
        setupVoiceChat();
    } else {
        // 否则等待AudioRecorder加载完成
        window.addEventListener('load', () => {
            // 尝试多次初始化，确保依赖已加载
            setTimeout(setupVoiceChat, 500);
        });
    }
    
    // 初始状态设置
    endCallButton.disabled = true;
    statusElement.textContent = "准备就绪，点击「开始通话」按钮开始";
    
    console.log("语音通话按钮已初始化");
});
