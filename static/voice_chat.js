/**
 * 实时语音通话功能 - 重构版
 * 提供更简洁、可靠的语音交互体验
 * 
 * 该文件作为模块入口，负责初始化并导出语音通话功能
 */

// 导入必要的模块
import VoiceChat from './voice_chat/core.js';
import AudioRecorder from './js/audio-recorder.js';
import AudioStreamingSystem from './js/audio-streaming.js';
import MessageHandler from './js/message-handler.js';
import Typewriter from './js/typewriter.js';

// 初始化全局对象
let voiceChat = null;
let audioRecorder = null;

// 等待DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', async () => {
    console.log("初始化语音通话模块...");
    
    try {
        // 获取必要的DOM元素
        const elementRefs = {
            chatMessages: document.getElementById('chat-messages'),
            statusElement: document.getElementById('status-message'),
            startButton: document.getElementById('start-call'),
            stopButton: document.getElementById('end-call')
        };
        
        // 验证DOM元素
        for (const [key, element] of Object.entries(elementRefs)) {
            if (!element) {
                console.warn(`DOM元素 '${key}' 未找到`);
            }
        }
        
        // 初始化VoiceChat实例
        voiceChat = new VoiceChat(elementRefs);
        
        // 将实例暴露给全局，方便其他模块（如app.js）访问
        window.voiceChat = voiceChat;
        
        // 添加兼容方法，确保app.js中的调用能正常工作
        window.voiceChat.startCall = function() {
            return this.startConversation();
        };
        
        window.voiceChat.endCall = function() {
            return this.endConversation();
        };
        
        // 检查浏览器兼容性
        checkBrowserSupport(elementRefs.statusElement);
        
        console.log("语音通话模块初始化成功");
    } catch (error) {
        console.error("语音通话模块初始化失败:", error);
    }
    
    console.log("语音通话模块已加载 - 使用模块化架构");
});

/**
 * 检查浏览器是否支持所需的API
 * @param {HTMLElement} statusElement - 状态显示元素
 */
function checkBrowserSupport(statusElement) {
    // 检查浏览器是否支持必要的Web API
    const hasMediaDevices = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const hasAudioContext = !!(window.AudioContext || window.webkitAudioContext);
    const hasWebAudio = !!window.AudioBuffer;
    const hasEventSource = !!window.EventSource;
    
    let supportMessage = "";
    let isSupported = true;
    
    if (!hasMediaDevices) {
        supportMessage += "麦克风API不支持! ";
        isSupported = false;
    }
    
    if (!hasAudioContext || !hasWebAudio) {
        supportMessage += "Web Audio API不支持! ";
        isSupported = false;
    }
    
    if (!hasEventSource) {
        supportMessage += "EventSource API不支持! ";
        isSupported = false;
    }
    
    if (!isSupported && statusElement) {
        statusElement.textContent = "浏览器不完全支持所需功能: " + supportMessage;
        statusElement.style.color = "#f44336";
        console.warn("浏览器兼容性问题:", supportMessage);
        return false;
    }
    
    // 如果一切正常，不更改原始状态消息
    return true;
}

// 导出语音通话模块
export { voiceChat, audioRecorder };
