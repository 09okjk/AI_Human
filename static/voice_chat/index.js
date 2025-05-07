/**
 * 语音通话模块入口
 * 将所有模块整合，并暴露语音通话实例
 */
import VoiceChat from './core.js';
import audioModule from './audio.js';
import uiModule from './ui.js';
import apiModule from './api.js';

// 将模块方法绑定到VoiceChat类的原型
Object.assign(VoiceChat.prototype, audioModule);
Object.assign(VoiceChat.prototype, uiModule);
Object.assign(VoiceChat.prototype, apiModule);

// 页面加载完成后初始化
function initializeVoiceChat() {
    // 创建语音通话实例
    window.voiceChat = new VoiceChat();
    
    // 绑定按钮事件 - 确保ID与index.html匹配
    const startCallBtn = document.getElementById('start-call');
    const endCallBtn = document.getElementById('end-call');
    const voiceBtn = document.getElementById('voice-button');
    
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
    
    if (voiceBtn) {
        voiceBtn.addEventListener('click', () => {
            if (window.voiceChat && window.voiceChat.isCallActive) {
                // 如果正在录音则停止，否则开始录音
                if (window.voiceChat.isRecording) {
                    window.voiceChat.processRecording();
                } else {
                    window.voiceChat.startRecording();
                }
            } else {
                // 如果通话未活跃，尝试开始通话
                if (window.voiceChat) window.voiceChat.startCall();
            }
        });
    }
    
    // 页面卸载时自动结束通话
    window.addEventListener('beforeunload', () => {
        if (window.voiceChat && window.voiceChat.isCallActive) {
            window.voiceChat.endCall();
        }
    });
    
    console.log("语音通话模块已加载并绑定事件 - 适配index.html");
}

// 如果DOM已经加载完成，立即初始化，否则等待DOM加载完成
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeVoiceChat);
} else {
    initializeVoiceChat();
}

// 导出VoiceChat类，允许其他模块使用
export default VoiceChat;
