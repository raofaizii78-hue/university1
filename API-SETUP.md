# API setup

The frontend uses the Node.js API configured in `public/config.js`. The API stores accounts, sessions, password-reset tokens, and student records in SQLite. Student records are shared with every signed-in account; only the account that created a record can update or delete it.

## Local development

1. Install Node.js 22.13 or newer.
2. Open a terminal in this folder and run `node server.js`.
3. Keep that terminal open while using the page.
4. Check `http://127.0.0.1:3000/health`. It should return `{"status":"ok","storage":"sqlite"}`.
5. Open `public/h1.html` or serve the `public` folder with VS Code Live Server.

No package installation is required. Node's built-in SQLite module is used. By default, the API listens only on the local computer and allows local/file-based frontend origins.

## One shared server for all users

All users and devices must connect to the same API process and its same persistent SQLite database. Deploy the Node API on a server with durable disk storage, and run one API instance against that database file. Do not use an ephemeral filesystem or multiple API instances with separate SQLite files: accounts and student records would not be shared or could disappear on restart.

Configure the server environment:

- `FIU_HOST=0.0.0.0` lets other devices reach the API through the server's network interface.
- `FIU_PORT=3000` selects the listening port if the host requires a specific port.
- `FIU_DB_PATH` can point to a database file on the host's persistent disk. If omitted, it uses `fiu.sqlite` beside `server.js`.
- `FIU_ALLOWED_ORIGINS` is a comma-separated list of exact frontend origins allowed by CORS, for example `https://university.example,https://www.university.example`. Do not include paths or use `*`.

Set these values in the hosting provider's environment configuration, start the server with `node server.js`, and configure the provider's HTTPS endpoint/reverse proxy to route requests to the API port. Use HTTPS for the public API and frontend.

Update `apiBaseUrl` in `public/config.js` to the API's public HTTPS URL, for example:

```js
apiBaseUrl: 'https://api.university.example',
```

Publish the frontend with that configuration, then test its `/health` endpoint and sign up two separate accounts. A student added by either account should appear in both accounts' Student List. Keep the API database file private and backed up; it contains account credentials (hashed) and student information.

The CORS allowlist is a browser policy, not a replacement for authentication. Student APIs still require a valid signed-in session. The API does not send password-reset emails: reset links are printed in the API server log, so configure a real email provider before public production use.

## Password reset

For local development, the API prints password-reset links to the terminal running `node server.js`. It does not send email. Configure a real email provider before relying on password resets in production.
