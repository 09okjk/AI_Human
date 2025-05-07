/**
 * 实时语音通话功能 - 重构版
 * 提供更简洁、可靠的语音交互体验
 * 
 * 该文件作为模块入口，负责初始化并导出语音通话功能
 */

// 导入必要的模块
import VoiceChat from './voice_chat/core.js';
import AudioRecorder from './js/audio-recorder.js'; // 引入录音对话功能

// 初始化全局对象
let voiceChat = null;
let audioRecorder = null;

// 等待DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', async () => {
    console.log("初始化语音通话模块...");
    
    try {
        // 1. 创建音频上下文
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // 2. 初始化录音对话功能
        const statusElement = document.getElementById('status-message');
        audioRecorder = new AudioRecorder(statusElement);
        
        // 3. 初始化语音通话功能
        voiceChat = new VoiceChat();
        
        // 4. 连接录音对话功能和语音通话功能
        voiceChat.setAudioRecorder(audioRecorder);
        
        // 5. 验证初始化
        if (!voiceChat.checkInitialization()) {
            console.error("语音通话功能初始化失败");
            if (statusElement) {
                statusElement.textContent = "语音通话功能初始化失败，请刷新页面重试";
            }
        } else {
            console.log("语音通话模块初始化成功");
        }
        
        // 6. 将实例暴露给全局，方便访问
        window.voiceChat = voiceChat;
        window.audioRecorder = audioRecorder;
        
    } catch (error) {
        console.error("语音通话模块初始化失败:", error);
    }
    
    console.log("语音通话模块已加载 - 使用模块化架构");
});

// 导出语音通话模块
export { voiceChat, audioRecorder };
