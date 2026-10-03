/* Batimint — ajuste la hauteur des formulaires intégrés (iframe[data-batimint-form]). */
(function () {
  if (window.__batimintEmbed) return;
  window.__batimintEmbed = true;
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.type !== 'batimint:height' || typeof data.height !== 'number') return;
    var frames = document.querySelectorAll('iframe[data-batimint-form]');
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === event.source) {
        frames[i].style.height = Math.min(Math.max(data.height, 300), 4000) + 'px';
      }
    }
  });
})();
