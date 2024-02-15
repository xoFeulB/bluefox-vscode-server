const vscode = require("vscode");
const http = require("http");
const ws = require("ws");
const fs = require("fs");
// const path = require("path");
const url = require("url");
const glob = require("glob");
const opn = require("opn");

const log = console.log;

class UI {
	// https://code.visualstudio.com/api/references/icons-in-labels
	constructor() {
		this.statusBarItem;
	}

	init() {
		this.statusBarItem = Object.assign(
			vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100),
			{
				text: "-.,.- BlueFox is OffLine.",
				command: "BlueFoxServer.OnLine",
			}
		);
		this.statusBarItem.show();
	}

	dispose() {
		this.statusBarItem.dispose();
	}

}

class Server {
	constructor(context) {
		this.context = context;
		this.httpServer;
		this.webSocketServer;
		this.OnLine = false;
	}

	start() {
		this.API = {
			"/getFileTree.get": (query, response) => {
				let workspaceItems = vscode.workspace.workspaceFolders.map((workspaceFolder) => {
					return {
						workspace: workspaceFolder.name,
						files: glob.sync(`${workspaceFolder.uri.path.slice(1)}/**/*.js`).map(
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
				response.writeHead(200, {
					"Content-Type": "application/json"
				});
				response.end(JSON.stringify(workspaceItems), "utf-8");
			},
			"/getFile.get": (query, response) => {
				let workspaceFolders = {};
				vscode.workspace.workspaceFolders.forEach((workspaceFolder) => {
					workspaceFolders[workspaceFolder.name] = workspaceFolder.uri.path;
				});
				query = JSON.parse(query);
				fs.readFile(`${workspaceFolders[query.workspace].slice(1)}${query.path}`,
					(error, content) => {
						response.writeHead(200, { "Content-Type": "text/javascript" });
						response.end(content, "utf-8");
					}
				);
			}
		};
		this.httpServer = http.createServer((request, response) => {
			if (url.parse(request.url).pathname in this.API) {
				let R = this.API[url.parse(request.url).pathname](decodeURI(url.parse(request.url).query), response);

			} else {
				fs.readFile(this.context.asAbsolutePath("/media/index.html"),
					(error, content) => {
						response.writeHead(200, { "Content-Type": "text/html" });
						response.end(content, "utf-8");
					});
			}
		}).listen(7777);

		this.webSocketServer = new ws.Server({ port: 8888 });
		this.webSocketServer.on("connection", webSocket => {
			webSocket.on("message", (message) => {
			});
			webSocket.on("close", () => {
			});
		});
		this.OnLine = true;
	}

	stop() {
		this.httpServer.close();
		this.webSocketServer.close();
		this.OnLine = false;
	}
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	let ui = new UI();
	ui.init();
	let server = new Server(context);

	Object.entries(
		{
			"BlueFoxServer.OnLine": () => {
				if (!server.OnLine) {
					server.start();
					ui.statusBarItem.text = "^.,.^ BlueFox is OnLine.";
					ui.statusBarItem.command = "BlueFoxServer.OffLine";
				}
			},
			"BlueFoxServer.OffLine": () => {
				if (server.OnLine) {
					server.stop();
					ui.statusBarItem.text = "-.,.^ BlueFox is OffLine.";
					ui.statusBarItem.command = "BlueFoxServer.OnLine";
				}
			},
			"BlueFoxServer.RunScript": (_) => {
				if (server.OnLine) {
					ui.statusBarItem.text = "^.,.^ BlueFox is OnLine.";
					ui.statusBarItem.command = "BlueFoxServer.OffLine";
					fs.readFile(_.path.slice(1),"utf-8",
						(error, content) => {
							[...server.webSocketServer.clients][0].send(
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
					ui.statusBarItem.text = "^.,.^ BlueFox is OnLine.";
					ui.statusBarItem.command = "BlueFoxServer.OffLine";
					fs.readFile(_.path.slice(1),"utf-8",
					(error, content) => {
						[...server.webSocketServer.clients][0].send(
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
					ui.statusBarItem.text = "^.,.^ BlueFox is OnLine.";
					ui.statusBarItem.command = "BlueFoxServer.OffLine";
				} else {
					server.start();
					opn("http://127.0.0.1:7777");
					ui.statusBarItem.text = "^.,.^ BlueFox is OnLine.";
					ui.statusBarItem.command = "BlueFoxServer.OffLine";
				}
			},
		}
	).forEach(([command, callback]) => {
		context.subscriptions.push(
			vscode.commands.registerCommand(command, callback)
		);
	});


}

function deactivate() { }

module.exports = {
	activate,
	deactivate
}
