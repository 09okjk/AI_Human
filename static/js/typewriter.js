/**
 * 打字机效果模块
 * 负责处理文本流式打字效果的显示
 */

// 打字机状态
const typewriterState = {
    target: null,
    interval: null,
    index: 0,
    buffer: '',
    isQuoted: false,
};

/**
 * 重置打字机状态
 */
function resetTypewriter() {
    if (typewriterState.interval) {
        clearInterval(typewriterState.interval);
        typewriterState.interval = null;
    }
    typewriterState.target = null;
    typewriterState.index = 0;
    typewriterState.buffer = '';
    typewriterState.isQuoted = false;
}

/**
 * 添加新文本到打字缓冲区
 * @param {string} content - 要添加的文本内容
 * @param {boolean} isTranscript - 是否为转录内容（需要引号）
 * @returns {string} - 当前缓冲区的全部内容
 */
function addToTypingBuffer(content, isTranscript = false) {
    if (isTranscript && !typewriterState.isQuoted) {
        // 如果是transcript类型且还没有引号，添加前引号
        typewriterState.isQuoted = true;
        typewriterState.buffer = `"${content}`;
    } else {
        // 其他情况直接追加
        typewriterState.buffer += content;
    }
    console.log('[DEBUG] 累计文本:', typewriterState.buffer);
    return typewriterState.buffer;
}

/**
 * 启动打字机效果
 * @param {HTMLElement} target - 目标DOM元素
 * @param {number} speed - 打字速度（毫秒）
 */
function startTypewriter(target, chatContainer, speed = 15) {
    typewriterState.target = target;
    
    // 如果打字机正在运行，则不需要重新启动
    if (typewriterState.interval) return; 
    
    typewriterState.interval = setInterval(() => {
        // 确保情况变化时能正确更新DOM
        if (typewriterState.index < typewriterState.buffer.length) {
            if (typewriterState.index === 0) {
                typewriterState.target.innerHTML = typewriterState.buffer.charAt(0);
            } else {
                typewriterState.target.innerHTML += typewriterState.buffer.charAt(typewriterState.index);
            }
            typewriterState.index++;
            // 每次打字后自动滚动到最新位置
            if (chatContainer) {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }
        } else {
            // 已补全到当前目标缓冲区，暂停等待新片段
            clearInterval(typewriterState.interval);
            typewriterState.interval = null;
        }
    }, speed);
}

/**
 * 处理流结束时的打字机状态
 * @param {function} onComplete - 完成后的回调
 */
function finalizeTypewriter(onComplete) {
    // 如果是引用式消息，添加右引号
    if (typewriterState.isQuoted && !typewriterState.buffer.endsWith('"')) {
        console.log('[调试] 添加结束引号');  
        typewriterState.buffer += '"';
    }
    
    // 不立即结束动画，继续打字机效果
    if (typewriterState.target) {
        startTypewriter(typewriterState.target);
    }
    
    // 等待打字机效果自然完成后再执行回调
    const checkComplete = setInterval(() => {
        if (!typewriterState.interval) {
            clearInterval(checkComplete);
            if (onComplete) onComplete();
        }
    }, 100);
}

/**
 * 获取当前的打字缓冲区内容
 * @returns {string}
 */
function getTypingBuffer() {
    return typewriterState.buffer;
}

// 导出模块接口
export default {
    resetTypewriter,
    addToTypingBuffer,
    startTypewriter,
    finalizeTypewriter,
    getTypingBuffer
};
