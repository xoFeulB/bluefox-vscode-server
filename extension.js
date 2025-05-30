const vscode = require("vscode");
const http = require("http");
const ws = require("ws");
const fs = require("fs");
const url = require("url");
const glob = require("glob");
const crypto = require("crypto");
const path = require("path");

const log = console.log;
const mime = {
  "txt": "text/plain",
  "html": "text/html",
  "css": "text/css",
  "js": "application/javascript",
  "jpg": "image/jpg",
  "jpeg": "image/jpeg",
  "png": "image/png",
  "gif": "image/gif",
  "ico": "image/ico",
  "mp4": "video/mp4",
  "mp3": "audio/mp3",
  "otf": "application/x-font-otf",
  "woff": "application/x-font-woff",
  "ttf": "application/x-font-ttf",
  "svg": "image/svg+xml",
  "json": "application/json",
  "md": "text/markdown",
};

class State {
  constructor(context) {
    this.statusBarItem;
    this.context = context;
  }

  init() {
    this.context.globalState.setKeysForSync(["server.online"]);
    this.statusBarItem = Object.assign(
      vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100),
      {
        text: "-.,.- BlueFox is OffLine.",
        command: "BlueFoxServer.OnLine",
      }
    );
    this.offLine();
    this.statusBarItem.show();
  }

  dispose() {
    this.statusBarItem.dispose();
  }

  onLine() {
    this.statusBarItem.text = "^.,.^ BlueFox is OnLine.";
    this.statusBarItem.command = "BlueFoxServer.OffLine";
    this.context.globalState.update("server.online", true);
  }

  offLine() {
    this.statusBarItem.text = "-.,.^ BlueFox is OffLine.";
    this.statusBarItem.command = "BlueFoxServer.OnLine";
    this.context.globalState.update("server.online", false);
  }
}

class Gate {
  constructor(context) {
    this.context = context;
    this.httpServer;
    this.webSocketServer;
    this.webSocketGate;
    this.workspaceClients = {};
    this.OnLine = false;
  }

  start() {
		/* httpServer */ {
      let GET_API = {
        "/GetWorkspace.get": async (query, response) => {
          let R = [];
          for (let uuid of Object.keys(this.workspaceClients)) {
            R.push(
              await this.workspaceClients[uuid].send(
                {
                  type: "GetWorkspace"
                }
              )
            );
          }
          response.writeHead(200, {
            "Content-Type": "application/json"
          });
          response.end(JSON.stringify(R), "utf-8");
        },
        "/GetFile.get": async (query, response) => {
          try {
            query = JSON.parse(query);
            let filepath = (await this.workspaceClients[query.id].send(
              Object.assign(
                query,
                {
                  type: "GetFilePath"
                }
              )
            )).filePath;
            let R = fs.readFileSync(filepath.replaceAll("../", ""), "utf-8");
            response.writeHead(200, { "Content-Type": "application/javascript" });
            response.end(R, "utf-8");
          } catch (e) {
            response.writeHead(200, { "Content-Type": "application/javascript" });
            response.end(`window.alert("^.,.^ Error !");`, "utf-8");
          }
        },
        "/R": async (query, response) => {
          try {
            query = query.split("/");
            let uuid = query[1];
            let workspace = query[2];
            let file_name = query.slice(-1)[0];
            let extension = file_name.split(".").slice(-1);
            let path = `/${query.slice(3).join("/")}`;

            let filepath = (await this.workspaceClients[uuid].send(
              {
                type: "GetFilePath",
                id: uuid,
                workspace: workspace,
                path: path
              },
            )).filePath;
            let R = fs.readFileSync(filepath.replaceAll("../", ""));

            let header = { "Content-Type": (extension in mime) ? mime[extension] : "application/octet-stream" };
            response.writeHead(200, header);
            response.end(R, "binary");
          } catch {
            response.writeHead(404, { "Content-Type": "text/plain" });
            response.end("", "utf-8");
          }
        },
        "/": async (query, response) => {
          GET_API["/index.html"](query, response);
        },
        "/index.html": async (query, response) => {
          fs.readFile(
            this.context.asAbsolutePath("/media/index.html"),
            "utf-8",
            (error, content) => {
              response.writeHead(200, { "Content-Type": "text/html" });
              response.end(content, "utf-8");
            }
          );
        }
      };
      let POST_API = {};

      let method = {
        "GET": (request, response) => {
          GET_API[url.parse(request.url).pathname](decodeURI(url.parse(request.url).query), response);
        },
        "POST": (request, response) => {
          let body = "";
          request.on('data', (chunk) => {
            body += chunk
          }).on('end', () => {
            POST_API[url.parse(request.url).pathname](body, response);
          })
        },
      };
      let method_fileserver = {
        "GET": (request, response) => {
          if (request.url == "/") {
            request.url = "/index.html";
          }
          let extension = request.url.split(".").slice(-1);
          let R = fs.readFileSync(`${vscode.workspace.workspaceFolders[0].uri.path.slice(1)}${request.url}`.replaceAll("../", ""), "utf-8");
          let header = { "Content-Type": (extension in mime) ? mime[extension] : "application/octet-stream" };
          response.writeHead(200, header);
          response.end(R, "binary");
        }
      }
      this.httpServer = http.createServer((request, response) => {
        try {
          if (request.headers.host == "localhost.bluefox.ooo:7777") {
            method[request.method](request, response);
          } else if (request.headers.host == "127.0.0.1:7777") {
            method_fileserver[request.method](request, response);
          } else {
            throw new Error("");
          }
        } catch (e) {
          response.writeHead(404, { "Content-Type": "text/html" });
          response.end("^.,.^ < 404!", "utf-8");
        }
      }).listen(7777);
    }
		/* webSocketServer Browser communicate connection */ {
      this.webSocketServer = new ws.Server({ port: 8888 });
    }
		/* WebSocketGate VSCode workspace connection */ {
      let push_function = {
        "RunScript": (data) => {
          [...this.webSocketServer.clients][0].send(
            JSON.stringify(data)
          );
        }
      }
      this.webSocketGate = new ws.Server({ port: 8887 });
      this.webSocketGate.on("connection", async (webSocket) => {
        webSocket.id = crypto.randomUUID();
        this.workspaceClients[webSocket.id] = {
          webSocket: webSocket,
          messagePool: {},
          send: async (message) => {
            this.workspaceClients[webSocket.id].webSocket.send(
              JSON.stringify(Object.assign(message, { id: webSocket.id }))
            );
            let R = new Promise((resolve, reject) => {
              this.workspaceClients[webSocket.id].messagePool[webSocket.id] = (_) => {
                resolve(_);
              };
            });
            return R;
          }
        };
        [...this.webSocketServer.clients].forEach((client) => {
          client.send(
            JSON.stringify(
              {
                type: "ReLoad",
              }
            )
          );
        });


        webSocket.on("message", async (message) => {
          let data = JSON.parse(message);
          if (data.id in this.workspaceClients[webSocket.id].messagePool) {
            await this.workspaceClients[webSocket.id].messagePool[data.id](data);
            delete this.workspaceClients[webSocket.id].messagePool[data.id];
          } else {
            push_function[data.type](data);
          }
        });
        webSocket.on("close", () => {
          delete this.workspaceClients[webSocket.id];
          [...this.webSocketServer.clients].forEach((client) => {
            client.send(
              JSON.stringify(
                {
                  type: "ReLoad",
                }
              )
            );
          });
        });
      });
    }
    this.OnLine = true;
  }

  stop() {
    this.httpServer.close();
    this.webSocketServer.close();
    this.webSocketGate.close();
    this.OnLine = false;
  }
}

class Server {
  constructor(context) {
    this.context = context;
    this.webSocketClient;
    this.OnLine = false;

    this.API = {
      "GetWorkspace": (data) => {
        let workspace = vscode.workspace.workspaceFolders.map((workspaceFolder) => {
          return {
            name: workspaceFolder.name,
            objects: glob.sync(`${workspaceFolder.uri.path.slice(1)}/**/*`).map(
              (_) => {
                let r = {
                  path: _.replace(/\\/g, "/").slice(workspaceFolder.uri.fsPath.length),
                  isFile: fs.statSync(_).isFile(),
                }
                return r;
              }
            ),
          }
        });
        return { workspace: workspace };
      },
      "GetFilePath": (data) => {
        let workspaceFolders = {};
        vscode.workspace.workspaceFolders.forEach((workspaceFolder) => {
          workspaceFolders[workspaceFolder.name] = workspaceFolder.uri.path;
        });
        return { filePath: `${workspaceFolders[data.workspace].slice(1)}${data.path}` };
      }
    };
  }

  start() {
    this.webSocketClient = new ws("http://localhost:8887");
    this.webSocketClient.addEventListener("open", (event) => { });
    this.webSocketClient.addEventListener("message", (event) => {
      let data = JSON.parse(event.data);
      let R = this.API[data.type](data);
      delete data.type;
      this.webSocketClient.send(
        JSON.stringify(Object.assign(data, R))
      );
    });
    this.webSocketClient.addEventListener("close", (event) => { });
    this.webSocketClient.addEventListener("error", (event) => { });
    this.OnLine = true;
  }
  stop() {
    this.webSocketClient.close();
    this.OnLine = false;
  }
  runScript(buf) {
    this.webSocketClient.send(
      JSON.stringify({
        type: "RunScript",
        content: buf
      })
    );
  }
}

let state;
let server;
let gate;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  gate = new Gate(context);
  server = new Server(context);
  state = new State(context);
  state.init();
  state.offLine();

  Object.entries(
    {
      "BlueFoxServer.OnLine": () => {
        try { gate.start(); } catch (e) { }
        try { server.start(); } catch (e) { }
        try { state.onLine(); } catch (e) { }
      },
      "BlueFoxServer.OffLine": () => {
        try { gate.stop(); } catch (e) { }
        try { server.stop(); } catch (e) { }
        try { state.offLine(); } catch (e) { }
      },
      "BlueFoxServer.RunScript": (_) => {
        let R = fs.readFileSync(_.path.slice(1).replaceAll("../", ""), "utf-8");
        server.runScript(R);
      },
    }
  ).forEach(([command, callback]) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, callback)
    );
  });


}

function deactivate() {
  state.offLine();
  server.stop();
}

module.exports = {
  activate,
  deactivate
}
