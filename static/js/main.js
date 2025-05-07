/**
 * 主应用入口
 * 负责初始化语音通话模块和绑定UI事件
 */

// 导入VoiceChat类 - 使用相对路径
import VoiceChat from './VoiceChat.js';

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    console.log("正在初始化语音通话系统...");
    
    try {
        // 创建语音通话实例
        window.voiceChat = new VoiceChat();
        
        // 绑定按钮事件
        bindUIEvents();
        
        console.log("语音通话模块已加载并绑定事件");
    } catch (error) {
        console.error("初始化语音通话失败:", error);
        document.getElementById('status-message').textContent = '初始化失败: ' + error.message;
    }
});

/**
 * 绑定UI事件
 */
function bindUIEvents() {
    // 绑定通话控制按钮
    const startCallBtn = document.getElementById('start-call');
    const endCallBtn = document.getElementById('end-call');
    const voiceButton = document.getElementById('voice-button');
    const textInput = document.getElementById('text-input');
    const sendButton = document.getElementById('send-button');
    
    if (startCallBtn) {
        startCallBtn.addEventListener('click', () => {
            if (window.voiceChat) {
                window.voiceChat.startCall();
            }
        });
    }
    
    if (endCallBtn) {
        endCallBtn.addEventListener('click', () => {
            if (window.voiceChat) {
                window.voiceChat.endCall();
            }
        });
    }
    
    // 绑定即时录音按钮
    if (voiceButton) {
        voiceButton.addEventListener('click', () => {
            if (window.voiceChat) {
                // 检查是否已在录音
                if (!window.voiceChat.isRecording) {
                    window.voiceChat.startRecording();
                } else {
                    window.voiceChat.stopRecording();
                    window.voiceChat.processRecording();
                }
            }
        });
    }
    
    // 绑定文本发送
    if (sendButton && textInput) {
        sendButton.addEventListener('click', () => {
            sendTextMessage();
        });
        
        textInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendTextMessage();
            }
        });
    }
    
    // 页面卸载时自动结束通话
    window.addEventListener('beforeunload', () => {
        if (window.voiceChat && window.voiceChat.isCallActive) {
            window.voiceChat.endCall();
        }
    });
}

/**
 * 发送文本消息
 */
function sendTextMessage() {
    const textInput = document.getElementById('text-input');
    const text = textInput.value.trim();
    
    if (text && window.voiceChat) {
        window.voiceChat.sendTextMessage(text);
        textInput.value = '';
    }
}
