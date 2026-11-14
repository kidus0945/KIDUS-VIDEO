const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

let serverProc = null;
const PORT = "3456";

function waitForServer(url, retries = 40) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      attempts += 1;
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (attempts >= retries) {
          reject(new Error("Local server did not start in time."));
        } else {
          setTimeout(check, 250);
        }
      });
    };
    check();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    title: "Kidus Studio",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadURL(`http://127.0.0.1:${PORT}`);
}

app.whenReady().then(async () => {
  const appRoot = app.isPackaged ? path.dirname(process.execPath) : __dirname;
  const envPath = path.join(appRoot, ".env");

  if (!process.env.GEMINI_API_KEY && !fs.existsSync(envPath)) {
    dialog.showMessageBoxSync({
      type: "info",
      title: "Kidus Studio Setup",
      message: "Place a .env file with GEMINI_API_KEY=\"your_key\" in the same folder as Kidus Studio.exe to enable Amharic audio synthesis.",
    });
  }

  const serverEntry = path.join(__dirname, "server.ts");
  serverProc = spawn(process.execPath, [serverEntry], {
    cwd: __dirname,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT,
    },
    stdio: "inherit",
  });

  try {
    await waitForServer(`http://127.0.0.1:${PORT}/api/health`);
    createWindow();
  } catch (err) {
    dialog.showErrorBox("Kidus Studio Error", String(err));
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (serverProc) {
    serverProc.kill();
    serverProc = null;
  }
  app.quit();
});
