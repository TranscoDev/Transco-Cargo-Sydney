// 📎 Photo button for the website chat (every page with the assistant).
// Like WhatsApp: picking a photo shows a preview above the message box,
// the customer can type a message with it, then sends with the page's
// own send button (or Enter). × removes the photo.
// The photo is shrunk in the browser (longest side 1600px, JPEG) so
// uploads stay quick on phones; the server reads it with the question
// (agentAnswer.js) and keeps it privately for staff.
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
      ".tc-photo-btn:hover{border-color:#1d3557}.tc-photo-btn:disabled{opacity:.5;cursor:default}" +
      ".tc-photo-preview{display:flex;align-items:center;gap:10px;padding:8px 14px;border-top:1px solid #e3e6e4;background:#f7f8f7;font-size:13px;color:#4a5550}" +
      ".tc-photo-preview img{width:52px;height:52px;object-fit:cover;border-radius:8px;flex-shrink:0;border:1px solid #d7dbd9}" +
      ".tc-photo-preview span{flex:1;min-width:0}" +
      ".tc-photo-remove{flex-shrink:0;width:30px;height:30px;border-radius:50%;border:none;background:#e3e6e4;color:#333;cursor:pointer;font-size:17px;line-height:1}";
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

    var row = input.parentNode;
    var sendBtn = row.querySelector("button:not(.tc-photo-btn)");
    var placeholder = input.placeholder;
    var pending = null; // base64 of the chosen photo, until sent
    var preview = null;

    var picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "image/*";
    picker.style.display = "none";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tc-photo-btn";
    btn.title = "Add a photo";
    btn.setAttribute("aria-label", "Add a photo");
    btn.textContent = "📎";
    btn.addEventListener("click", function () { picker.click(); });

    function clearPhoto() {
      pending = null;
      if (preview && preview.parentNode) preview.parentNode.removeChild(preview);
      preview = null;
      input.placeholder = placeholder;
    }

    function showPhoto(data) {
      clearPhoto();
      pending = data;
      preview = document.createElement("div");
      preview.className = "tc-photo-preview";
      var img = document.createElement("img");
      img.src = "data:image/jpeg;base64," + data;
      img.alt = "Photo to send";
      var note = document.createElement("span");
      note.textContent = "Photo ready — add a message if you like, then press send.";
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "tc-photo-remove";
      remove.setAttribute("aria-label", "Remove photo");
      remove.textContent = "×";
      remove.addEventListener("click", function () { clearPhoto(); input.focus(); });
      preview.appendChild(img);
      preview.appendChild(note);
      preview.appendChild(remove);
      if (row.parentNode) row.parentNode.insertBefore(preview, row);
      input.placeholder = "Add a message (optional)…";
      input.focus();
    }

    // With a photo waiting, the page's send button / Enter send it (with
    // whatever was typed) instead of the page's normal text send.
    function sendPhoto(e) {
      if (!pending) return;
      if (sendBtn && sendBtn.disabled) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      var data = pending;
      var caption = (input.value || "").trim();
      input.value = "";
      clearPhoto();
      send({ data: data, mimeType: "image/jpeg" }, caption);
    }
    if (sendBtn) sendBtn.addEventListener("click", sendPhoto, true);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") sendPhoto(e); }, true);

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
          showPhoto(data);
        })
        .catch(function () { alert("Sorry, that photo couldn't be read. Please try a JPG or PNG."); })
        .then(function () { btn.disabled = false; });
    });

    row.insertBefore(btn, input);
    row.insertBefore(picker, input);
  }

  window.TranscoChatPhoto = { attach: attach };
})();
