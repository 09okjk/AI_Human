/**
 * 实时语音通话功能 - 入口脚本
 * 负责初始化语音通话组件和连接UI元素
 */

import VoiceChat from './core.js';

// 当DOM加载完成时初始化应用
document.addEventListener('DOMContentLoaded', initializeApp);

/**
 * 初始化应用
 */
function initializeApp() {
    // 获取DOM元素引用
    const elementRefs = {
        chatMessages: document.getElementById('chatMessages'),
        statusElement: document.getElementById('status'),
        startButton: document.getElementById('startButton'),
        stopButton: document.getElementById('stopButton')
    };
    
    // 初始化VoiceChat实例
    const voiceChat = new VoiceChat(elementRefs);
    
    // 注册按钮事件
    elementRefs.startButton.addEventListener('click', () => {
        // 检查音频上下文是否已恢复，处理Chrome自动播放策略
        if (voiceChat.audioContext.state === 'suspended') {
            voiceChat.audioContext.resume();
        }
    });
    
    // 显示浏览器支持情况
    checkBrowserSupport(elementRefs.statusElement);
}

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
    
    if (!isSupported) {
        statusElement.textContent = "浏览器不完全支持所需功能: " + supportMessage;
        statusElement.style.color = "#f44336";
        return false;
    }
    
    // 如果一切正常，不更改原始状态消息
    return true;
}
