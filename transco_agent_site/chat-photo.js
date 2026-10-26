// 📎 Photo button for the website chat (every page with the assistant).
// The photo is shrunk in the browser (longest side 1600px, JPEG) before
// it is sent, so uploads stay quick on phones; the server reads it with
// the question (agentAnswer.js) and keeps it privately for staff.
//
// Usage, after the page's chat input exists:
//   TranscoChatPhoto.attach(inputEl, function (image, caption) { ... })
// image = { data: base64, mimeType: "image/jpeg" }; caption = what was
// typed in the input (cleared here).
(function () {
  var MAX_SIDE = 1600;
  var MAX_BYTES = 2.8 * 1024 * 1024;

  function addStyle() {
    if (document.getElementById("tc-photo-style")) return;
    var s = document.createElement("style");
    s.id = "tc-photo-style";
    s.textContent =
      ".tc-photo-btn{flex-shrink:0;width:42px;height:42px;border-radius:50%;border:1px solid #d7dbd9;background:#fff;" +
      "cursor:pointer;font-size:18px;line-height:1;display:inline-flex;align-items:center;justify-content:center;padding:0}" +
      ".tc-photo-btn:hover{border-color:#1d3557}.tc-photo-btn:disabled{opacity:.5;cursor:default}";
    document.head.appendChild(s);
  }

  function shrink(file, quality) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        var dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("not an image")); };
      img.src = url;
    });
  }

  function attach(input, send) {
    if (!input || !input.parentNode || input.getAttribute("data-photo")) return;
    input.setAttribute("data-photo", "1");
    addStyle();

    var picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "image/*";
    picker.style.display = "none";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tc-photo-btn";
    btn.title = "Send a photo";
    btn.setAttribute("aria-label", "Send a photo");
    btn.textContent = "📎";
    btn.addEventListener("click", function () { picker.click(); });

    picker.addEventListener("change", function () {
      var file = picker.files && picker.files[0];
      picker.value = "";
      if (!file) return;
      if (!/^image\//.test(file.type)) { alert("Please choose a photo."); return; }
      btn.disabled = true;
      shrink(file, 0.82)
        .then(function (data) { return data.length * 0.75 > MAX_BYTES ? shrink(file, 0.6) : data; })
        .then(function (data) {
          if (data.length * 0.75 > MAX_BYTES) { alert("That photo is too large — please try another one."); return; }
          var caption = (input.value || "").trim();
          input.value = "";
          send({ data: data, mimeType: "image/jpeg" }, caption);
        })
        .catch(function () { alert("Sorry, that photo couldn't be read. Please try a JPG or PNG."); })
        .then(function () { btn.disabled = false; });
    });

    input.parentNode.insertBefore(btn, input);
    input.parentNode.insertBefore(picker, input);
  }

  window.TranscoChatPhoto = { attach: attach };
})();
