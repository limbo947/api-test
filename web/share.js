// share.js – URL 分享模块 (v2)
// 使用加密混淆保护敏感内容，支持加密链接和旧版明文链接的兼容
;(function () {
  'use strict';

  const C = window.AppConfig;
  const SHARE_VERSION_PREFIX = 'e:';

  /**
   * 创建分享管理器
   * @param {object} ctx
   * @param {HTMLElement} ctx.shareBtn - 分享按钮
   * @param {Function} ctx.getConfigData - 获取当前配置数据
   * @param {Function} ctx.applyConfig - 应用从 URL 恢复的配置
   * @param {Function} ctx.showToast - Toast 提示函数
   * @returns {object}
   */
  function createShareManager(ctx) {
    const showToast = ctx.showToast || (function () {});
    const getConfigData = ctx.getConfigData || (function () { return {}; });
    const applyConfig = ctx.applyConfig || (function () {});

    /**
     * 构建加密的分享 URL
     * @returns {string}
     */
    function buildShareUrl() {
      try {
        const config = getConfigData();
        const jsonStr = JSON.stringify(config);
        const encrypted = C.obfuscateValue(SHARE_VERSION_PREFIX + jsonStr);
        return location.origin + location.pathname + '?config=' + encodeURIComponent(encrypted);
      } catch (e) {
        showToast('生成分享链接失败：' + e.message, 'error');
        return '';
      }
    }

    /**
     * 从 URL 参数恢复配置（兼容加密和明文两种格式）
     * @returns {boolean} 是否成功恢复
     */
    function restoreFromUrlParams() {
      try {
        const params = new URLSearchParams(location.search);
        let rawConfig = params.get('config');
        if (!rawConfig) return false;

        // 检测并解密加密格式
        if (typeof C.deobfuscateValue === 'function') {
          try {
            const decrypted = C.deobfuscateValue(rawConfig);
            if (decrypted && decrypted !== rawConfig) {
              rawConfig = decrypted;
            }
          } catch (e) {
            // 非加密链接，保持原值
          }
        }

        // 移除版本前缀
        if (rawConfig.startsWith(SHARE_VERSION_PREFIX)) {
          rawConfig = rawConfig.substring(SHARE_VERSION_PREFIX.length);
        }

        const config = JSON.parse(decodeURIComponent(rawConfig));
        applyConfig(config);
        return true;
      } catch (e) {
        console.warn('从 URL 参数恢复配置失败：', e.message);
        return false;
      }
    }

    /**
     * 复制文本到剪贴板
     * @param {string} text
     * @returns {Promise<boolean>}
     */
    async function copyToClipboard(text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          return true;
        }
        // 回退方案
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        return true;
      } catch (e) {
        return false;
      }
    }

    if (ctx.shareBtn) {
      ctx.shareBtn.addEventListener('click', async function () {
        const url = buildShareUrl();
        if (!url) return;

        const success = await copyToClipboard(url);
        if (success) {
          showToast('分享链接已复制到剪贴板（配置已加密保护）', 'success');
        } else {
          const fullUrl = url;
          try {
            navigator.clipboard.writeText(fullUrl).then(function () {
              showToast('分享链接已复制到剪贴板（配置已加密保护）', 'success');
            }).catch(function () {
              showToast('复制失败，请手动复制链接', 'error');
            });
          } catch (e2) {
            showToast('复制失败，请手动复制链接', 'error');
          }
        }
      });
    }

    return {
      buildShareUrl: buildShareUrl,
      restoreFromUrlParams: restoreFromUrlParams
    };
  }

  window.ShareManager = { create: createShareManager };
})();