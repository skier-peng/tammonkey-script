// ==UserScript==
// @name         视频本地检查器
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  检查视频是否在本地存在,并高亮显示不存在的视频
// @author       Roo
// @match        *://*/*
// @match        *://bbs.oehm1.com/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
    'use strict';

    // 创建搜索状态提示
    function createSearchingIndicator() {
        const indicator = document.createElement('div');
        indicator.style.cssText = 'position: fixed; top: 10px; right: 10px; background-color: rgba(0, 0, 0, 0.7); color: white; padding: 10px; border-radius: 5px; z-index: 9999;';
        indicator.textContent = '猴子正在搜索...';
        document.body.appendChild(indicator);
        return indicator;
    }

    // Everything服务配置
    const EVERYTHING_HOST = 'http://192.168.3.252:31458';

    // 视频番号提取正则表达式 - 支持多种格式
    const VIDEO_CODE_PATTERNS = [
        /【影片名稱】：.?([A-Za-z]+-?\d+)(?:C)?/i,
        /【影片名称】：.?([A-Za-z]+-?\d+)(?:C)?/i,
        /\b([A-Za-z]+-?\d+)(?:C)?\b/i
    ];

    // 需要跳过的常见格式标识符（不是真正的番号）
    const SKIP_CODES = ["MP4", "HD", "AVI", "RMVB", "WMV", "MOV"];

    // 转换视频番号为标准格式
    function normalizeVideoCode(code) {
        // 检查是否为需要跳过的标识符
        if (SKIP_CODES.includes(code.toUpperCase())) {
            return null; // 跳过处理
        }

        // 去除末尾的C(不区分大小写)
        const codeWithoutC = code.replace(/C$/i, '');

        const match = codeWithoutC.match(/([A-Za-z]+)-?(\d+)/i);
        if (!match) return null; // 如果不是有效的番号格式，也返回null

        const [, prefix, number] = match;
        return `${prefix.toUpperCase()}-${number.padStart(3, '0')}`;
    }

    // 视频状态枚举
    const VideoStatus = {
        NOT_EXIST: 0,// 不存在
        EXISTS_NO_CN: 1,// 存在但无中文版本
        EXISTS_WITH_CN: 2// 存在中文版本
    };

    // 获取状态消息
    function getStatusMessage(status) {
        switch (status) {
            case VideoStatus.EXISTS_WITH_CN:
                return '【是否存在】：<span style="color: #008000; font-weight: bold;">存在中文版本</span>';
            case VideoStatus.EXISTS_NO_CN:
                return '【是否存在】：<span style="color: #FFA500; font-weight: bold;">存在无中文版本</span>';
            case VideoStatus.NOT_EXIST:
                return '【是否存在】：<span style="color: #ff0000; font-weight: bold;">不存在</span>';
            default:
                return '【是否存在】：<span style="color: #ff0000; font-weight: bold;">状态未知</span>';
        }
    }

    // 检查本地是否存在视频
    async function checkLocalVideo(code) {
        console.log('正在检查视频:', code);

        // 先检查是否有中文版本
        const hasCnVersion = await new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `${EVERYTHING_HOST}/?search=${encodeURIComponent(code + ' -c')}`,
                onload: function (response) {
                    try {
                        const hasResults = response.responseText.includes('结果') &&
                            !response.responseText.includes('0 个结果');
                        console.log('中文版本检查结果:', hasResults ? '存在' : '不存在');
                        resolve(hasResults);
                    } catch (e) {
                        console.error('检查中文版本失败:', e);
                        resolve(false);
                    }
                },
                onerror: function () {
                    console.error('Everything HTTP请求失败');
                    resolve(false);
                }
            });
        });

        if (hasCnVersion) {
            return VideoStatus.EXISTS_WITH_CN;
        }

        // 如果没有中文版本，检查是否有其他版本
        const hasOtherVersion = await new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `${EVERYTHING_HOST}/?search=${encodeURIComponent(code)}`,
                onload: function (response) {
                    try {
                        const hasResults = response.responseText.includes('结果') &&
                            !response.responseText.includes('0 个结果');
                        console.log('其他版本检查结果:', hasResults ? '存在' : '不存在');
                        resolve(hasResults);
                    } catch (e) {
                        console.error('检查其他版本失败:', e);
                        resolve(false);
                    }
                },
                onerror: function () {
                    console.error('Everything HTTP请求失败');
                    resolve(false);
                }
            });
        });

        return hasOtherVersion ? VideoStatus.EXISTS_NO_CN : VideoStatus.NOT_EXIST;
    }

    // 检查Everything服务是否可用
    async function checkEverythingServiceAvailability() {
        console.log('正在检查Everything服务可用性...');
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: EVERYTHING_HOST,
                timeout: 5000,
                onload: function(response) {
                    if (response.status === 200) {
                        console.log('Everything服务可用');
                        resolve(true);
                    } else {
                        console.error('Everything服务响应异常:', response.status);
                        resolve(false);
                    }
                },
                onerror: function(error) {
                    console.error('Everything服务不可用:', error);
                    resolve(false);
                },
                ontimeout: function() {
                    console.error('Everything服务请求超时');
                    resolve(false);
                }
            });
        });
    }

    // 处理视频条目
    function processVideoEntry(element, videoEntries, videoStatuses) {
        console.log('开始处理视频条目，共有', videoEntries.length, '个条目');

        try {
            if (!element || !videoEntries || videoEntries.length === 0 || !videoStatuses || videoStatuses.length === 0) {
                console.log('无效的输入参数');
                return;
            }

            // 判断是否为纯文本处理（首次处理）
            const isFirstTimeProcessing = videoEntries[0].code === '';

            // 解析内容为HTML文档
            const parser = new DOMParser();
            const doc = parser.parseFromString('<div>' + element.innerHTML + '</div>', 'text/html');
            const contentDiv = doc.querySelector('div');

            // 清理HTML内容 - 移除所有已有的【是否存在】标签
            let htmlContent = contentDiv.innerHTML;
            htmlContent = htmlContent.replace(/【是否存在】：<span[^>]*>[^<]*<\/span><br>/g, '');

            // 清理并标准化分隔符
            htmlContent = htmlContent.replace(/(<br>)?(={10,}|[-]{10,})(<br>)?/g, '<br>');

            // 使用更精确的分隔符正则表达式识别内容条目
            const separatorPattern = /(<br>)*[\s]*?(={5,}|[-]{5,})[\s]*?(<br>)*/g;
            const contentEntries = htmlContent.split(separatorPattern).filter(entry => entry && entry.trim() !== '');

            // 保存结果HTML
            let newHtml = '';
            let entryVideoIndex = 0; // 用于 videoEntries/videoStatuses 索引

            // 处理每个条目
            for (let entryIndex = 0; entryIndex < contentEntries.length; entryIndex++) {
                const entry = contentEntries[entryIndex];
                if (!entry || entry.trim() === '') {
                    continue;
                }

                // 按行分割
                let lines = entry.split('<br>');
                lines = lines.map(line => line.trim()).filter(line => line !== '');

                // 如果是首次处理（纯文本处理），直接添加条目
                if (isFirstTimeProcessing) {
                    const processedEntry = lines.join('<br>');
                    // 添加到新HTML，仅在条目之间添加简单换行，不添加分隔符
                    newHtml += processedEntry + (entryIndex < contentEntries.length - 1 ? '<br>' : '');
                    continue;
                }

                // 如果不是首次处理，需要处理番号和状态
                // 在条目中找到所有番号位置及其索引
                const entryVideos = []; // 存储格式：{lineIndex: 行索引, charIndex: 行内字符位置, videoIndex: 对应videoEntries中的索引}

                // 第一遍扫描：找出条目中所有番号
                for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                    const line = lines[lineIndex];

                    for (const pattern of VIDEO_CODE_PATTERNS) {
                        const regex = new RegExp(pattern, 'gi');
                        let match;
                        while ((match = regex.exec(line)) !== null) {
                            if (match[1] && entryVideoIndex < videoEntries.length) {
                                const originalCode = match[1];
                                const normalizedCode = normalizeVideoCode(originalCode);
                                if (normalizedCode && normalizedCode === videoEntries[entryVideoIndex].code) {
                                    entryVideos.push({
                                        lineIndex: lineIndex,
                                        charIndex: match.index,
                                        videoIndex: entryVideoIndex,
                                        originalCode: originalCode,
                                        status: videoStatuses[entryVideoIndex]
                                    });
                                    entryVideoIndex++;
                                }
                            }
                        }
                    }
                }

                // 如果条目中没有找到番号，直接添加该条目
                if (entryVideos.length === 0) {
                    const processedEntry = lines.join('<br>');
                    newHtml += processedEntry + (entryIndex < contentEntries.length - 1 ? '<br>=============================<br>' : '');
                    continue;
                }

                // 第二遍扫描：处理每一行，插入状态标记
                const processedLines = [];
                const processedVideoIndices = new Set(); // 跟踪已处理的番号索引

                for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                    const line = lines[lineIndex];
                    processedLines.push(line);

                    // 找出当前行包含的所有番号
                    const videosInCurrentLine = entryVideos.filter(v => v.lineIndex === lineIndex);

                    if (videosInCurrentLine.length > 0) {
                        // 当前行有番号，为每个番号添加状态
                        for (const video of videosInCurrentLine) {
                            if (!processedVideoIndices.has(video.videoIndex)) {
                                processedLines.push(getStatusMessage(video.status));
                                processedVideoIndices.add(video.videoIndex);
                            }
                        }
                    }
                }

                // 确保所有番号都被处理 - 如果有未处理的番号，添加到条目末尾
                for (const video of entryVideos) {
                    if (!processedVideoIndices.has(video.videoIndex)) {
                        processedLines.push(getStatusMessage(video.status));
                        processedVideoIndices.add(video.videoIndex);
                    }
                }

                // 合并处理后的行
                const processedEntry = processedLines.join('<br>');

                // 添加到新HTML，在条目之间添加统一的分隔符
                if (entryIndex < contentEntries.length - 1) {
                    newHtml += processedEntry + '<br>=============================<br>';
                } else {
                    newHtml += processedEntry;
                }
            }

            // 更新内容
            element.innerHTML = newHtml;
            console.log('内容处理完成，处理了', entryVideoIndex, '个番号');
        } catch (error) {
            console.error('处理视频条目时出错:', error);
            throw error;
        }
    }

    // 查找页面中的视频番号及其所在条目
    function findVideoEntries(content) {
        // 先收集所有可能的匹配结果
        const allMatches = [];
        // 只允许番号前后为非字母数字（防止MIDV100被IDV100误命中）
        const codePattern = /(?<![A-Za-z0-9])([A-Za-z]{2,5})-?(\d{3,5})(?:C)?(?![A-Za-z0-9])/g;
        let match;
        while ((match = codePattern.exec(content)) !== null) {
            if (match[1] && match[2]) {
                const prefix = match[1].toUpperCase();
                const number = match[2].padStart(3, '0');
                const code = `${prefix}-${number}`;
                // 跳过无效番号
                if (SKIP_CODES.includes(prefix)) continue;
                allMatches.push({
                    code,
                    originalCode: match[0],
                    index: match.index
                });
            }
        }
        // 去重，防止子串
        const filtered = [];
        const seen = new Set();
        for (const m of allMatches) {
            if (!seen.has(m.code)) {
                filtered.push(m);
                seen.add(m.code);
            }
        }
        return filtered;
    }

    // 为页面添加自动"是否存在"标识的功能，不需要访问Everything服务
    function addExistsMarkers() {
        const contentElements = document.querySelectorAll('.f14 #read_tpc, #read_tpc');

        if (contentElements.length === 0) {
            console.log('未找到内容元素');
            return;
        }

        for (const element of contentElements) {
            // 检查是否已处理过
            if (element.dataset.processed) {
                continue;
            }

            try {
                // 处理每个内容元素
                processVideoEntry(element, [{ index: 0, code: '' }], [VideoStatus.EXISTS_WITH_CN]);
                element.dataset.processed = 'true';
            } catch (error) {
                console.error('处理元素时出错:', error);
            }
        }
    }

    // 新增：提取页面所有标准磁力链接，并按番号归类（增强版，支持上下文查找）
    function extractMagnetLinks() {
        // 只提取标准格式的磁力链接
        const magnetPattern = /magnet:?xt=urn:btih:[0-9A-Fa-f]{40,}[^\"]*/g;
        const links = Array.from(document.querySelectorAll('a[href^="magnet:?xt=urn:btih:"]'));
        // 支持textarea中的磁力链接提取
        const magnetTextareas = Array.from(document.querySelectorAll('textarea'));
        console.log('全部textarea数量', magnetTextareas.length);
        const magnets = {};
        // 先收集页面所有番号，便于后续模糊匹配
        const allCodes = new Set();
        document.body.innerText.replace(/([A-Z]{2,5})-?(\d{3,5})/gi, (m, p1, p2) => {
            if (p1 && p2) allCodes.add(`${p1.toUpperCase()}-${p2.padStart(3, '0')}`);
        });
        links.forEach(a => {
            const href = a.getAttribute('href');
            const match = href.match(magnetPattern);
            if (!match) return;
            // 1. 先尝试a标签文本和href
            let code = null;
            const codePattern = /([A-Z]{2,5})-(\d{3,5})/i;
            const textMatch = a.textContent.match(codePattern);
            if (textMatch) {
                code = `${textMatch[1].toUpperCase()}-${textMatch[2].padStart(3, '0')}`;
            } else {
                const hrefMatch = href.match(codePattern);
                if (hrefMatch) {
                    code = `${hrefMatch[1].toUpperCase()}-${hrefMatch[2].padStart(3, '0')}`;
                }
            }
            // 2. 向上查找父节点文本
            let cur = a.parentElement, tryCount = 0;
            while (!code && cur && tryCount < 3) {
                const parentText = cur.innerText || '';
                const parentMatch = parentText.match(codePattern);
                if (parentMatch) {
                    code = `${parentMatch[1].toUpperCase()}-${parentMatch[2].padStart(3, '0')}`;
                    break;
                }
                cur = cur.parentElement;
                tryCount++;
            }
            // 3. 遍历同一行/同一段落的兄弟节点
            if (!code && a.parentElement) {
                const siblings = Array.from(a.parentElement.childNodes);
                for (const node of siblings) {
                    if (node === a) continue;
                    const txt = node.textContent || '';
                    const sibMatch = txt.match(codePattern);
                    if (sibMatch) {
                        code = `${sibMatch[1].toUpperCase()}-${sibMatch[2].padStart(3, '0')}`;
                        break;
                    }
                }
            }
            // 4. 最后模糊匹配：与页面所有番号比对，若a标签祖先节点文本包含某番号，则归类
            if (!code && a.closest) {
                let ancestor = a;
                for (let i = 0; i < 3; i++) {
                    ancestor = ancestor.parentElement;
                    if (!ancestor) break;
                    const txt = ancestor.innerText || '';
                    for (const c of allCodes) {
                        if (txt.includes(c)) {
                            code = c;
                            break;
                        }
                    }
                    if (code) break;
                }
            }
            // 5. 归类
            if (code) {
                if (!magnets[code]) magnets[code] = [];
                if (!magnets[code].includes(href)) {
                    magnets[code].push(href);
                }
            }
            // 日志输出调试
            console.log('[磁力提取]', { code, href, text: a.textContent });
        });
        magnetTextareas.forEach(textarea => {
            const value = textarea.value || textarea.innerText || '';
            if (/magnet:?xt=urn:btih:/i.test(value)) {
                // 1. 先尝试textarea文本中提取番号
                let code = null;
                const codePattern = /([A-Z]{2,5})-(\d{3,5})/i;
                const textMatch = value.match(codePattern);
                if (textMatch) {
                    code = `${textMatch[1].toUpperCase()}-${textMatch[2].padStart(3, '0')}`;
                }
                // 2. 向上查找父节点文本
                let cur = textarea.parentElement, tryCount = 0;
                while (!code && cur && tryCount < 3) {
                    const parentText = cur.innerText || '';
                    const parentMatch = parentText.match(codePattern);
                    if (parentMatch) {
                        code = `${parentMatch[1].toUpperCase()}-${parentMatch[2].padStart(3, '0')}`;
                        break;
                    }
                    cur = cur.parentElement;
                    tryCount++;
                }
                // 3. 遍历同一行/同一段落的兄弟节点
                if (!code && textarea.parentElement) {
                    const siblings = Array.from(textarea.parentElement.childNodes);
                    for (const node of siblings) {
                        if (node === textarea) continue;
                        const txt = node.textContent || '';
                        const sibMatch = txt.match(codePattern);
                        if (sibMatch) {
                            code = `${sibMatch[1].toUpperCase()}-${sibMatch[2].padStart(3, '0')}`;
                            break;
                        }
                    }
                }
                // 4. 最后模糊匹配：与页面所有番号比对，若textarea祖先节点文本包含某番号，则归类
                if (!code && textarea.closest) {
                    let ancestor = textarea;
                    for (let i = 0; i < 3; i++) {
                        ancestor = ancestor.parentElement;
                        if (!ancestor) break;
                        const txt = ancestor.innerText || '';
                        for (const c of allCodes) {
                            if (txt.includes(c)) {
                                code = c;
                                break;
                            }
                        }
                        if (code) break;
                    }
                }
                // 5. 归类
                if (code) {
                    if (!magnets[code]) magnets[code] = [];
                    if (!magnets[code].includes(value)) {
                        magnets[code].push(value);
                    }
                }
                // 日志输出调试
                console.log('[磁力textarea提取]', { code, value });
            }
        });
        // 输出全部磁力归类结果
        console.log('[全部磁力归类]', magnets);
        return magnets;
    }

    // 新增：生成无中文版本影片的列表并插入页面顶部
    function insertNoCnList(noCnList) {
        if (!noCnList.length) return;
        const container = document.createElement('div');
        container.style.cssText = 'background: #fffbe6; border: 1px solid #ffe58f; padding: 10px; margin-bottom: 16px; font-size: 15px;';
        container.innerHTML = `<b>以下影片本地仅有无中文版本：</b><ul style="margin: 8px 0 0 20px;"></ul>`;
        const ul = container.querySelector('ul');
        // 新增：提取页面所有磁力链接，按番号归类
        const allMagnets = extractMagnetLinks();
        noCnList.forEach(item => {
            const a = document.createElement('a');
            a.href = `#${item.anchorId}`;
            a.textContent = item.name;
            a.style.color = '#d48806';
            a.style.marginRight = '8px';
            const li = document.createElement('li');
            li.appendChild(a);
            li.appendChild(document.createTextNode(`(${item.code}) `));
            // 搜索链接
            const magnetSearch = document.createElement('a');
            magnetSearch.href = `https://sukebei.nyaa.si/?f=0&c=0_0&q=${encodeURIComponent(item.code)}`;
            magnetSearch.textContent = '[搜索磁链]';
            magnetSearch.style.color = '#1890ff';
            magnetSearch.style.marginLeft = '8px';
            magnetSearch.target = '_blank';
            li.appendChild(magnetSearch);
            // 新增：展示页面中提取到的标准磁力链接
            if (allMagnets[item.code] && allMagnets[item.code].length > 0) {
                allMagnets[item.code].forEach(mag => {
                    const magA = document.createElement('a');
                    magA.href = mag;
                    magA.textContent = '[磁力]';
                    magA.style.color = '#52c41a';
                    magA.style.marginLeft = '8px';
                    magA.target = '_blank';
                    li.appendChild(magA);
                });
            }
            ul.appendChild(li);
        });
        // 插入到内容元素前
        const firstContent = document.querySelector('#read_tpc, .tpc_content, .f14');
        if (firstContent && firstContent.parentNode) {
            firstContent.parentNode.insertBefore(container, firstContent);
        }
    }

    // 新增：在页面插入无中文版本和不存在影片的表格
    function insertSummaryTable(noCnList, notExistList) {
        if (!noCnList.length && !notExistList.length) return;
        const container = document.createElement('div');
        container.style.cssText = 'background: #fffbe6; border: 1px solid #ffe58f; padding: 10px; margin-bottom: 16px; font-size: 15px;';
        let html = '<b>影片本地状态汇总：</b>';
        // 新增：提取页面所有磁力链接，按番号归类
        const allMagnets = extractMagnetLinks();
        // 整合所有番号，去重
        const allCodes = {};
        noCnList.forEach(item => {
            allCodes[item.code] = allCodes[item.code] || { ...item };
            allCodes[item.code].hasLocal = true;
            allCodes[item.code].hasCn = false;
        });
        notExistList.forEach(item => {
            allCodes[item.code] = allCodes[item.code] || { ...item };
            allCodes[item.code].hasLocal = false;
            allCodes[item.code].hasCn = false;
        });
        // 生成表格
        let table = `<div style="margin-top:10px;"><table border="1" cellpadding="4" style="border-collapse:collapse;margin-top:4px;min-width:300px;">
        <tr style="background:#fff1b8;"><th>番号</th><th>原始名称</th><th>跳转</th><th>本地有无</th><th>有无中文版本</th><th>磁力链接</th></tr>`;
        Object.values(allCodes).forEach(item => {
            let magnetLinks = '';
            if (allMagnets[item.code] && allMagnets[item.code].length > 0) {
                magnetLinks = allMagnets[item.code].map(mag => `<a href='${mag}' target='_blank' style='color:#52c41a;'>磁力</a>`).join('<br>');
            }
            table += `<tr><td>${item.code}</td><td>${item.name}</td><td><a href="#${item.anchorId}" style="color:#d48806;">跳转</a></td><td>${item.hasLocal ? '有' : '无'}</td><td>${item.hasCn ? '有' : '无'}</td><td>${magnetLinks}</td></tr>`;
        });
        table += '</table></div>';
        html += table;
        container.innerHTML = html;
        // 插入到内容元素前
        const firstContent = document.querySelector('#read_tpc, .tpc_content, .f14');
        if (firstContent && firstContent.parentNode) {
            firstContent.parentNode.insertBefore(container, firstContent);
        }
    }

    // 等待DOM加载完成后执行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => main(true));
    } else {
        main(true);
    }

    // 带初始处理参数的main函数
    async function main(needInitialProcessing = false) {
        const indicator = window.location.hostname === 'bbs.oehm1.com' ? createSearchingIndicator() : null;
        const noCnList = [];
        const notExistList = [];
        
        try {
            // 如果需要初始处理，先执行一次标记
            if (needInitialProcessing) {
                addExistsMarkers();
            }
            
            // 检查Everything服务是否可用
            const serviceAvailable = await checkEverythingServiceAvailability();
            if (!serviceAvailable) {
                console.log('Everything服务不可用，仅进行标记处理');
                // 显示提示信息并提早返回
                if (indicator) {
                    indicator.textContent = 'Everything服务不可用，无法检查本地文件';
                    setTimeout(() => indicator.remove(), 3000);
                }
                return;
            }

            // 查找可能包含内容的元素
            const contentElements = [
                document.querySelector('#read_tpc'),
                document.querySelector('.tpc_content'),
                document.querySelector('.f14')
            ].filter(Boolean);

            for (const element of contentElements) {
                try {
                    const content = element.innerText;
                    const videoEntries = findVideoEntries(content);

                    if (videoEntries.length > 0) {
                        console.log('找到番号：', videoEntries.map(e => `${e.originalCode}(${e.code})`).join(', '));
                        
                        // 批量处理请求，限制并发数量
                        const batchSize = 5;
                        const videoStatuses = [];
                        
                        // 分批处理请求
                        for (let i = 0; i < videoEntries.length; i += batchSize) {
                            const batch = videoEntries.slice(i, i + batchSize);
                            if (indicator) {
                                indicator.textContent = `猴子正在搜索... (${i}/${videoEntries.length})`;
                            }
                            const batchResults = await Promise.all(
                                batch.map(entry => checkLocalVideo(entry.code))
                            );
                            videoStatuses.push(...batchResults);
                        }

                        console.log('获取状态：', videoStatuses.join(', '));
                        console.log('番号对应：', videoEntries.map((e, i) =>
                            `${e.originalCode} -> ${getStatusMessage(videoStatuses[i])}`).join('\n'));

                        // 收集无中文版本影片
                        videoEntries.forEach((entry, i) => {
                            if (videoStatuses[i] === VideoStatus.EXISTS_NO_CN) {
                                noCnList.push({
                                    code: entry.code,
                                    name: entry.originalCode,
                                    anchorId: `video_${entry.code}_${i}`
                                });
                            } else if (videoStatuses[i] === VideoStatus.NOT_EXIST) {
                                notExistList.push({
                                    code: entry.code,
                                    name: entry.originalCode,
                                    anchorId: `video_${entry.code}_${i}`
                                });
                            }
                        });

                        // 给正文加锚点
                        if (videoStatuses.length === videoEntries.length) {
                            // 先清除原有标记，确保正确替换
                            delete element.dataset.processed;

                            // 先备份原始HTML以便调试
                            const originalHTML = element.innerHTML;

                            try {
                                // 替换无中文版本番号为带锚点的span
                                videoEntries.forEach((entry, i) => {
                                    if (videoStatuses[i] === VideoStatus.EXISTS_NO_CN) {
                                        const regex = new RegExp(entry.originalCode, 'g');
                                        element.innerHTML = element.innerHTML.replace(regex, `<span id="video_${entry.code}_${i}">${entry.originalCode}</span>`);
                                    }
                                });

                                // 使用实际获取的视频状态处理条目
                                processVideoEntry(element, videoEntries, videoStatuses);
                                console.log('处理完成，已应用视频状态');

                                // 处理成功后标记为已处理
                                element.dataset.processed = 'true';
                            } catch (error) {
                                // 如果处理失败，恢复原始HTML并记录错误
                                console.error('应用视频状态时出错:', error);
                                element.innerHTML = originalHTML;
                            }
                        } else {
                            console.warn('视频条目数量与状态数量不匹配，跳过状态应用');
                        }
                    }
                } catch (error) {
                    console.error('执行过程中出错:', error);
                }
            }

            // 新增：插入无中文版本和不存在影片的表格
            insertSummaryTable(noCnList, notExistList);
            
            // 搜索完成，更新提示信息
            if (indicator) {
                indicator.textContent = '搜索完成!';
            }
            console.log('搜索完成');
        } catch (error) {
            console.error('执行过程中出错:', error);
            if (indicator) {
                indicator.textContent = '执行过程中出错，请查看控制台';
            }
        } finally {
            if (indicator) {
                // 根据任务实际完成情况调整延迟
                const delay = noCnList.length > 0 ? 2000 : 1000;
                setTimeout(() => {
                    indicator.remove();
                    console.log('搜索提示已移除');
                }, delay);
            }
        }
    }
})();