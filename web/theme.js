;(function () {
  'use strict';

  const saved = localStorage.getItem('api-debugger-theme') || 'aurora';
  document.documentElement.setAttribute('data-theme', saved);

  document.querySelectorAll('.theme-btn').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.theme === saved);
  });

  document.querySelectorAll('.theme-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const theme = this.dataset.theme;
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('api-debugger-theme', theme);
      document.querySelectorAll('.theme-btn').forEach(function (b) {
        b.classList.toggle('active', b.dataset.theme === theme);
      });
    });
  });
})();