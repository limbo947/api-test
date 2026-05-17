// upload.js – 文件上传模块 (v2)
// 使用 Blob URL 进行预览，仅在插入消息时懒加载 dataUrl
;(function () {
  'use strict';

  const C = window.AppConfig;
  const DEFAULT_MAX_FILE_SIZE_MB = 20;
  const DEFAULT_MAX_TOTAL_SIZE_MB = 50;

  /**
   * 创建上传管理器
   * @param {object} ctx - 上下文对象
   * @param {HTMLElement} ctx.fileInput
   * @param {HTMLElement} ctx.uploadDropzone
   * @param {HTMLElement} ctx.uploadPreview
   * @param {HTMLElement} ctx.uploadHint
   * @param {HTMLElement} ctx.clearFilesBtn
   * @param {HTMLElement} ctx.insertFilesBtn
   * @param {Function} ctx.showToast
   * @param {Function} ctx.onFilesInserted - 当文件插入到消息时调用，传入 contentArray
   * @param {Function} ctx.getEndpointPath - 获取当前端点路径
   * @param {Function} ctx.getUploadType - 获取当前上传类型
   * @param {Function} ctx.createElement - DOM 创建辅助函数
   * @param {Function} ctx.clearElement - DOM 清空辅助函数
   * @param {number} [ctx.maxFileSizeMB]
   * @param {number} [ctx.maxTotalSizeMB]
   * @returns {object}
   */
  function createUploadManager(ctx) {
    const maxFileSize = (ctx.maxFileSizeMB || DEFAULT_MAX_FILE_SIZE_MB) * 1024 * 1024;
    const maxTotalSize = (ctx.maxTotalSizeMB || DEFAULT_MAX_TOTAL_SIZE_MB) * 1024 * 1024;
    const createElement = ctx.createElement;
    const clearElement = ctx.clearElement || C.clearElement;
    const showToast = ctx.showToast;
    const getEndpointPath = ctx.getEndpointPath;
    const getUploadType = ctx.getUploadType;
    const onFilesInserted = ctx.onFilesInserted || (function () {});

    let uploadedFiles = [];
    let currentUploadType = 'image';

    function getUploadAccept(type) {
      switch (type) {
        case 'image': return 'image/*';
        case 'audio': return 'audio/*';
        case 'video': return 'video/*';
        default: return '*/*';
      }
    }

    function getUploadHint(type) {
      switch (type) {
        case 'image': return '支持 JPG、PNG、GIF、WEBP 格式';
        case 'audio': return '支持 MP3、WAV、OGG、M4A 格式';
        case 'video': return '支持 MP4、WEBM、OGG 格式';
        default: return '支持常见格式';
      }
    }

    function revokeUploadedBlobUrls() {
      uploadedFiles.forEach(function (f) {
        if (f.blobUrl) URL.revokeObjectURL(f.blobUrl);
        if (f.dataUrl && f.dataUrl.startsWith('blob:')) URL.revokeObjectURL(f.dataUrl);
      });
    }

    function readFileAsDataUrl(file) {
      return new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.onload = function () {
          const result = reader.result;
          const base64 = result.substring(result.indexOf(',') + 1);
          resolve({ dataUrl: result, base64: base64 });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    function createFileInfo(file) {
      return {
        name: file.name,
        type: file.type,
        size: file.size,
        file: file,
        blobUrl: URL.createObjectURL(file),
        dataUrl: null,
        base64: null
      };
    }

    function renderUploadPreview() {
      clearElement(ctx.uploadPreview);
      uploadedFiles.forEach(function (fileInfo, idx) {
        const item = createElement('div', { className: 'upload-preview-item' });
        if (fileInfo.type.startsWith('image/')) {
          const img = createElement('img', { attrs: { src: fileInfo.blobUrl || fileInfo.dataUrl, alt: fileInfo.name } });
          item.appendChild(img);
        } else if (fileInfo.type.startsWith('video/')) {
          const video = createElement('video', { attrs: { src: fileInfo.blobUrl || fileInfo.dataUrl } });
          item.appendChild(video);
        } else if (fileInfo.type.startsWith('audio/')) {
          const audio = createElement('audio', { attrs: { controls: true, src: fileInfo.blobUrl || fileInfo.dataUrl } });
          item.appendChild(audio);
        }
        const nameSpan = createElement('span', { className: 'file-name', text: fileInfo.name });
        item.appendChild(nameSpan);
        const removeBtn = createElement('button', {
          className: 'remove-file',
          text: '×',
          attrs: { 'aria-label': '删除文件', title: '删除' }
        });
        removeBtn.addEventListener('click', function () {
          const removed = uploadedFiles[idx];
          if (removed && removed.blobUrl) URL.revokeObjectURL(removed.blobUrl);
          if (removed && removed.dataUrl && removed.dataUrl.startsWith('blob:')) URL.revokeObjectURL(removed.dataUrl);
          uploadedFiles.splice(idx, 1);
          renderUploadPreview();
        });
        item.appendChild(removeBtn);
        ctx.uploadPreview.appendChild(item);
      });
    }

    function handleFiles(files) {
      const validFiles = Array.from(files).filter(function (file) {
        const type = getUploadType ? getUploadType() : currentUploadType;
        if (type === 'image' && !file.type.startsWith('image/')) {
          showToast('「' + file.name + '」不是图片文件，已跳过', 'warning');
          return false;
        }
        if (type === 'audio' && !file.type.startsWith('audio/')) {
          showToast('「' + file.name + '」不是音频文件，已跳过', 'warning');
          return false;
        }
        if (type === 'video' && !file.type.startsWith('video/')) {
          showToast('「' + file.name + '」不是视频文件，已跳过', 'warning');
          return false;
        }
        if (file.size > maxFileSize) {
          showToast('「' + file.name + '」超过 ' + (ctx.maxFileSizeMB || DEFAULT_MAX_FILE_SIZE_MB) + 'MB 限制（当前 ' + (file.size / 1024 / 1024).toFixed(1) + 'MB），已跳过', 'warning');
          return false;
        }
        return true;
      });

      if (validFiles.length === 0) return;

      const currentTotalSize = uploadedFiles.reduce(function (sum, f) { return sum + f.size; }, 0);
      const newTotalSize = currentTotalSize + validFiles.reduce(function (sum, f) { return sum + f.size; }, 0);
      if (newTotalSize > maxTotalSize) {
        showToast('上传文件总大小超过 ' + (ctx.maxTotalSizeMB || DEFAULT_MAX_TOTAL_SIZE_MB) + 'MB 限制，请减少文件数量或大小', 'error');
        return;
      }

      const newFiles = validFiles.map(function (file) {
        return createFileInfo(file);
      });

      uploadedFiles = uploadedFiles.concat(newFiles);
      renderUploadPreview();
      showToast('已添加 ' + newFiles.length + ' 个文件', 'success');
    }

    function insertFilesToMessages() {
      if (uploadedFiles.length === 0) {
        showToast('请先上传文件', 'warning');
        return;
      }

      const endpointPath = getEndpointPath ? getEndpointPath() : '';

      const pendingCount = uploadedFiles.filter(function (f) { return !f.dataUrl; }).length;
      if (pendingCount > 0) {
        showToast('正在处理 ' + pendingCount + ' 个文件…', 'info');
      }

      const readPromises = uploadedFiles.map(function (file) {
        if (file.dataUrl) return Promise.resolve(file);
        return readFileAsDataUrl(file.file).then(function (result) {
          file.dataUrl = result.dataUrl;
          file.base64 = result.base64;
          if (file.blobUrl) {
            URL.revokeObjectURL(file.blobUrl);
            file.blobUrl = null;
          }
          return file;
        });
      });

      Promise.all(readPromises).then(function () {
        const contentArray = uploadedFiles.map(function (file) {
          if (file.type.startsWith('image/')) {
            return { type: 'image_url', image_url: { url: file.dataUrl, detail: 'auto' } };
          }
          if (file.type.startsWith('audio/')) {
            let format = file.type.split('/')[1] || 'mp3';
            if (format === 'mpeg') format = 'mp3';
            if (format === 'x-wav' || format === 'wav') format = 'wav';
            return { type: 'input_audio', input_audio: { data: file.base64, format: format } };
          }
          if (file.type.startsWith('video/')) {
            return { type: 'image_url', image_url: { url: file.dataUrl, detail: 'auto' } };
          }
          return { type: 'image_url', image_url: { url: file.dataUrl, detail: 'auto' } };
        });
        contentArray.push({ type: 'text', text: '' });
        onFilesInserted(contentArray);
      }).catch(function (err) {
        showToast('文件处理失败：' + err.message, 'error');
      });
    }

    function bindEvents() {
      document.querySelectorAll('.upload-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
          document.querySelectorAll('.upload-tab').forEach(function (t) { t.classList.remove('active'); });
          tab.classList.add('active');
          currentUploadType = tab.dataset.uploadType;
          ctx.fileInput.accept = getUploadAccept(currentUploadType);
          ctx.uploadHint.textContent = getUploadHint(currentUploadType);
        });
      });

      if (ctx.uploadDropzone) {
        ctx.uploadDropzone.addEventListener('click', function () {
          ctx.fileInput.click();
        });
        ctx.uploadDropzone.addEventListener('dragover', function (e) {
          e.preventDefault();
          ctx.uploadDropzone.classList.add('dragover');
        });
        ctx.uploadDropzone.addEventListener('dragleave', function () {
          ctx.uploadDropzone.classList.remove('dragover');
        });
        ctx.uploadDropzone.addEventListener('drop', function (e) {
          e.preventDefault();
          ctx.uploadDropzone.classList.remove('dragover');
          handleFiles(e.dataTransfer.files);
        });
      }

      if (ctx.fileInput) {
        ctx.fileInput.addEventListener('change', function (e) {
          handleFiles(e.target.files);
          ctx.fileInput.value = '';
        });
      }

      if (ctx.clearFilesBtn) {
        ctx.clearFilesBtn.addEventListener('click', function () {
          revokeUploadedBlobUrls();
          uploadedFiles = [];
          renderUploadPreview();
          showToast('已清空上传文件', 'info');
        });
      }

      if (ctx.insertFilesBtn) {
        ctx.insertFilesBtn.addEventListener('click', insertFilesToMessages);
      }
    }

    bindEvents();

    return {
      getUploadType: function () { return currentUploadType; },
      setUploadType: function (type) { currentUploadType = type; },
      getUploadedFiles: function () { return uploadedFiles; },
      revokeBlobUrls: revokeUploadedBlobUrls,
      handleFiles: handleFiles,
      insertFilesToMessages: insertFilesToMessages,
      renderPreview: renderUploadPreview
    };
  }

  window.UploadManager = { create: createUploadManager };
})();