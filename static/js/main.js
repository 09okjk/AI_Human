import VoiceChat from './VoiceChat.js';

/**
 * 页面初始化
 */
document.addEventListener('DOMContentLoaded', () => {
    // 创建语音通话实例
    window.voiceChat = new VoiceChat();
    
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
    
    console.log("语音通话模块已加载并绑定事件");
});
