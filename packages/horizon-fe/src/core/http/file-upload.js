function getError(url, file_ctx, xhr) {
    let msg;
    if (xhr.response) {
        msg = `${xhr.response.error || xhr.response}`;
    } else if (xhr.responseText) {
        msg = `${xhr.responseText}`;
    } else {
        msg = `fail to post ${url} ${xhr.status}`;
    }

    const err = new Error(msg);
    err.status = xhr.status;
    err.method = 'post';
    err.url = url;
    return err;
}

function getBody(xhr) {
    const text = xhr.responseText || xhr.response;
    if (!text) {
        return text;
    }

    try {
        return JSON.parse(text);
    } catch (e) {
        return text;
    }
}

export default function upload(url, file_ctx) {
    if (typeof XMLHttpRequest === 'undefined') {
        return;
    }

    const xhr = new XMLHttpRequest();

    file_ctx.abort = () => {
        xhr.abort();
    };

    if (xhr.upload) {
        xhr.upload.onprogress = function progress(e) {
            if (e.total > 0) {
                e.percent = Math.floor((e.loaded / e.total) * 100);
            }
            file_ctx.onProgress(e);
        };
    }

    const formData = new FormData();

    if (file_ctx.data) {
        Object.keys(file_ctx.data).forEach(key => {
            formData.append(key, file_ctx.data[key]);
        });
    }

    formData.append(file_ctx.filename, file_ctx.file, file_ctx.file.name);

    xhr.onerror = function error(e) {
        file_ctx.onError(e);
    };

    xhr.onload = function onload() {
        if (xhr.status < 200 || xhr.status >= 300) {
            return file_ctx.onError(getError(url, file_ctx, xhr));
        }

        file_ctx.onSuccess(getBody(xhr));
    };

    xhr.open('post', url, true);

    if (file_ctx.withCredentials && 'withCredentials' in xhr) {
        xhr.withCredentials = true;
    }

    const headers = file_ctx.headers || {};

    for (let item in headers) {
        if (headers.hasOwnProperty(item) && headers[item] !== null) {
            xhr.setRequestHeader(item, headers[item]);
        }
    }
    xhr.send(formData);
    return xhr;
}
