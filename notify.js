/* Notifications: uses the Firefox OS mozNotification API, with a
 * Web Notification fallback for desktop testing. */
var Notify = {
  init: function () {
    try {
      if (window.Notification && Notification.requestPermission &&
          Notification.permission !== 'granted') {
        Notification.requestPermission(function () {});
      }
    } catch (e) {}
  },

  show: function (title, body, icon, onclick) {
    // Legacy Firefox OS API (needs the "desktop-notification" permission)
    try {
      if (navigator.mozNotification && navigator.mozNotification.createNotification) {
        var n = navigator.mozNotification.createNotification(title, body, icon || '');
        n.onclick = function () {
          try { window.focus(); } catch (e) {}
          if (onclick) onclick();
        };
        n.show();
        return true;
      }
    } catch (e) {}

    // Fallback (desktop Firefox / newer builds)
    try {
      if (window.Notification && Notification.permission === 'granted') {
        var m = new Notification(title, { body: body, icon: icon || '' });
        m.onclick = function () {
          try { window.focus(); } catch (e) {}
          if (onclick) onclick();
        };
        return true;
      }
    } catch (e) {}
    return false;
  }
};
