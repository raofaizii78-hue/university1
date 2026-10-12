# Local API setup

The frontend calls a local Node.js API at `http://127.0.0.1:3000`. The API stores accounts, sessions, password-reset tokens, and student records in `fiu.sqlite` in this folder.

## Start the API

1. Install Node.js 22.13 or newer.
2. Open a terminal in this folder and run `node server.js`.
3. Keep that terminal open while using the page.
4. Check that the API is running at `http://127.0.0.1:3000/health`. It should return `{"status":"ok","storage":"sqlite"}`.
5. Open `h1.html` or serve the folder with VS Code Live Server.

No package installation is required. Node's built-in SQLite module is used. The API only listens on the local computer and allows local/file-based frontend origins.

## Password reset

The local development API prints password-reset links to the terminal running `node server.js`. It does not send email. Configure a real email provider and secure deployment before using this API for real users or putting it on the public internet.
