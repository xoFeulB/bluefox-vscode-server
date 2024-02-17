const vscode = require("vscode");
const http = require("http");
const ws = require("ws");
const fs = require("fs");
const url = require("url");
const glob = require("glob");
const opn = require("opn");
const crypto = require("crypto");

const log = console.log;

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

	}

	start() {
		this.API = {
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
					let R = fs.readFileSync(filepath, "utf-8");
					response.writeHead(200, { "Content-Type": "text/javascript" });
					response.end(R, "utf-8");
				} catch (e) {
					response.writeHead(200, { "Content-Type": "text/javascript" });
					response.end(`window.alert("^.,.^ Error !");`, "utf-8");
				}
			}
		};
		this.httpServer = http.createServer((request, response) => {
			if (url.parse(request.url).pathname in this.API) {
				this.API[url.parse(request.url).pathname](decodeURI(url.parse(request.url).query), response);

			} else {
				fs.readFile(this.context.asAbsolutePath("/media/index.html"), "utf-8",
					(error, content) => {
						response.writeHead(200, { "Content-Type": "text/html" });
						response.end(content, "utf-8");
					});
			}
		}).listen(7777);

		this.webSocketServer = new ws.Server({ port: 8888 });

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
			webSocket.on("message", async (message) => {
				let data = JSON.parse(message);
				if (Object.keys(this.workspaceClients[webSocket.id].messagePool).includes(data.id)) {
					await this.workspaceClients[webSocket.id].messagePool[data.id](data);
					delete this.workspaceClients[webSocket.id].messagePool[data.id];
				}
			});
			webSocket.on("close", () => {
				delete this.workspaceClients[webSocket.id];
			});
		});
	}

	stop() {
		this.httpServer.close();
		this.webSocketServer.close();
	}
}

class Server {
	constructor(context) {
		this.context = context;
		this.webSocketClient;
		this.id = null;
		this.OnLine = false;

		this.API = {
			"SetID": (data) => {
				this.id = data.id;
			},
			"GetID": (data) => {
				return this.id;
			},
			"GetWorkspace": (data) => {
				let workspace = vscode.workspace.workspaceFolders.map((workspaceFolder) => {
					return {
						name: workspaceFolder.name,
						objects: glob.sync(`${workspaceFolder.uri.path.slice(1)}/**/*`).map(
							(_) => {
								let r = {
									path: _.replace(/\\/g, "/").slice(workspaceFolder.uri.path.slice(1).length),
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
		this.webSocketClient = new ws("http://127.0.0.1:8887");
		this.webSocketClient.addEventListener("open", (event) => {

		});
		this.webSocketClient.addEventListener("message", (event) => {
			let data = JSON.parse(event.data);
			let R = this.API[data.type](data);
			delete data.type;
			this.webSocketClient.send(
				JSON.stringify(Object.assign(data, R))
			);
		});

		this.webSocketClient.addEventListener("close", (event) => {

		});

		this.webSocketClient.addEventListener("error", (event) => {

		});
		this.OnLine = true;
	}
	stop() {
		this.webSocketClient.close();
		this.OnLine = false;
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
	gate.start();
	server = new Server(context);
	state = new State(context);
	state.init();
	state.offLine();

	Object.entries(
		{
			"BlueFoxServer.OnLine": () => {
				if (!server.OnLine) {
					server.start();
					state.onLine();
				}
			},
			"BlueFoxServer.OffLine": () => {
				if (server.OnLine) {
					server.stop();
					state.offLine();
				}
			},
			"BlueFoxServer.RunScript": (_) => {
				if (server.OnLine) {
					fs.readFile(_.path.slice(1), "utf-8",
						(error, content) => {
							[...gate.webSocketServer.clients][0].send(
								JSON.stringify(
									{
										type: "RunScript",
										content: content,
									}
								)
							);
						});
				} else {
					server.start();
					state.onLine();
					fs.readFile(_.path.slice(1), "utf-8",
						(error, content) => {
							[...gate.webSocketServer.clients][0].send(
								JSON.stringify(
									{
										type: "RunScript",
										content: content,
									}
								)
							);
						});
				}
			},
			"BlueFoxServer.OpenBrowser": () => {
				if (server.OnLine) {
					opn("http://127.0.0.1:7777");
				} else {
					server.start();
					state.onLine();
					opn("http://127.0.0.1:7777");
				}
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
