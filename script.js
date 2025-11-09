//rename functionality
document.querySelectorAll("#rename-btn").forEach((btn) => {
  const fileName = btn.parentElement.parentElement.querySelector("#name");
  console.log(fileName.innerHTML)
  const ext = fileName.innerHTML.includes(".")
    ? fileName.innerHTML.split(".").pop()
    : "";
  let currName = fileName.innerHTML.replace(`.${ext}`, "");

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    const input = document.getElementById("rename");
    if (btn.innerHTML === "Rename") {
      input.removeAttribute("disabled");
      input.value = currName.replace(`.${ext}`, "");
      input.size = input.value.length;

      input.style.display = "inline";
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);

      btn.innerHTML = "Save";
    } else if (btn.innerHTML === "Save") {
      if (input.value !== "" && input.value !== currName) {
        const url =
          window.location.href +
          `?action=rename&f=${encodeURIComponent(currName)}`;

        const data = await patchRequestToServer(
          url,
          input.value + `${ext !== "" ? `.${ext}` : ""}`,
          currName + `${ext !== "" ? `.${ext}` : ""}`
        );

        if (data.success) {
          currName = fileName.innerHTML = input.value;
          fileName.innerHTML += `${ext !== "" ? `.${ext}` : ""}`;
        } else {
          alert("Rename Failed!! Try after sometimes.");
        }
      }
      input.style.display = "none";
      input.value = "";
      btn.innerHTML = "Rename";
      input.setAttribute("disabled", "");
    }
  });
});

//delete functionality
document.querySelectorAll("#delete-btn").forEach((btn) => {
  const name = btn.parentElement.parentElement.querySelector("#name");
  const directory = name.innerHTML.startsWith("📁")
    ? name.innerHTML.split("📁").pop().trim()
    : null;

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    let deleted = null;
    if (directory) {
      deleted = await deleteRequestToServer(
        window.location.href +
          `/delete?f=${encodeURIComponent(directory)}&t=dir`
      );
    } else {
      deleted = await deleteRequestToServer(
        window.location.href +
          `/delete?f=${encodeURIComponent(name.innerHTML.trim())}&t=file`
      );
    }

    if (deleted.success) {
      btn.parentElement.parentElement.parentElement.removeChild(btn.parentElement.parentElement);
    } else alert("Server issue..");
  });
});

//upload functionality
const uploadBtn = document.querySelector("#upload");
const cancelBtn = document.querySelector("#cancel");
const input = uploadBtn.previousElementSibling;
let progress = 0;
let files, xhr;
uploadBtn.addEventListener("click", async (e) => {
  e.preventDefault();

  if (uploadBtn.innerHTML === "Upload") {
    input.removeAttribute("disabled");
    console.dir(input);
    input.style.display = "inline";
    input.focus();
    uploadBtn.innerHTML = "Confirm";
    uploadBtn.setAttribute("type", "submit");
    return;
  }

  if (uploadBtn.innerHTML === "Confirm" && files) {
    input.setAttribute("disabled", "true");
    uploadBtn.style.display = "none";
    cancelBtn.style.display = "inline";

    for (let [key, file] of Object.entries(files)) {
      const url = window.location.href + `?action=post&f=${file.name}`;

      xhr = new XMLHttpRequest();
      xhr.open("POST", url, true);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          progress = (e.loaded / e.total) * 100;
          console.log("Uploaded " + progress.toFixed(2) + "%");
        }
      };

      xhr.onload = async () => {
        const response = await xhr.response;
        if (response) {
          const data = JSON.parse(response);
          if (data.success) {
            input.value = "";
            input.style.display = "none";
            input.removeAttribute("disabled");
            uploadBtn.innerHTML = "Upload";
            uploadBtn.style.display = "inline";
            cancelBtn.style.display = "none";
            window.location.reload();
          }
        }
      };

      xhr.onabort = () => {
        input.value = "";
        input.style.display = "none";
        input.removeAttribute("disabled");
        uploadBtn.innerHTML = "Upload";
        uploadBtn.style.display = "inline";
        cancelBtn.style.display = "none";
      };

      xhr.send(file);
    }
    return;
  }
});

cancelBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  if (xhr) {
    xhr.abort();
    return;
  }
});

input.addEventListener("change", (e) => {
  files = e.target.files;
  const form = document.querySelector("form");
  form.setAttribute("action", window.location.href);
});

async function postRequestToServer(url, file, signal) {
  const response = await fetch(url, {
    method: "POST",
    body: file,
    signal,
  });

  const data = await response.json();
  console.log(data);
  return data;
}

async function patchRequestToServer(url, newName, oldName) {
  console.log(newName, oldName);
  const response = await fetch(url, {
    method: "PATCH",
    body: JSON.stringify({
      oldName: oldName,
      newName: newName,
    }),
  });
  const data = await response.json();
  return data;
}

async function deleteRequestToServer(url) {
  const response = await fetch(url, {
    method: "DELETE",
  });
  return await response.json();
}
