// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const path = require('path');

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "lets-play-2048" is now active!');

	// Store the panel reference
	let panel = undefined;

	// Helper to load saved game state from globalState
	const loadSavedState = () => {
		return context.globalState.get('2048-state') || null;
	};

	// Register the command to show/toggle the panel
	const play2048Command = vscode.commands.registerCommand('lets-play-2048.play2048', function () {
		// Toggle: if panel exists, dispose it (hide); otherwise create it
		if (panel) {
			panel.dispose();
			panel = undefined;
			return;
		}

		// Create and show the webview panel
		panel = vscode.window.createWebviewPanel(
			'play2048Panel',
			'2048',
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))]
			}
		);

		// Set the webview content
		updateWebviewContent(panel, context);

		// Send saved state (if any) to the webview to restore the game
		setTimeout(() => {
			const saved = loadSavedState();
			if (saved) {
				panel.webview.postMessage({ command: 'loadState', state: saved });
			}
		}, 50);

		// Handle messages from the webview
		panel.webview.onDidReceiveMessage(
			message => {
				switch (message.command) {
					case 'hello':
						vscode.window.showInformationMessage(message.text);
						break;
					case 'saveState':
						// Persist the game state in globalState
						context.globalState.update('2048-state', message.state);
						break;
				}
			},
			undefined,
			context.subscriptions
		);

		// Handle panel disposal
		panel.onDidDispose(
			() => {
				panel = undefined;
			},
			undefined,
			context.subscriptions
		);
	});



	// Automatically show the panel when the view is revealed
	const viewProvider = vscode.window.registerWebviewViewProvider(
		'play2048Panel',
		{
			resolveWebviewView: (webviewView) => {
				webviewView.webview.options = {
					enableScripts: true,
					localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))]
				};

				updateWebviewContent({ webview: webviewView.webview }, context);

				// Send saved state to the webview (if exists)
				setTimeout(() => {
					const saved = loadSavedState();
					if (saved) {
						webviewView.webview.postMessage({ command: 'loadState', state: saved });
					}
				}, 50);

				webviewView.webview.onDidReceiveMessage(
					message => {
						switch (message.command) {
							case 'hello':
								vscode.window.showInformationMessage(message.text);
								break;
							case 'saveState':
								context.globalState.update('2048-state', message.state);
								break;
						}
					},
					undefined,
					context.subscriptions
				);
			}
		}
	);

	context.subscriptions.push(play2048Command);
	context.subscriptions.push(viewProvider);
}

/**
 * Update the webview content with HTML
 * @param {vscode.WebviewPanel | {webview: vscode.Webview}} panel
 * @param {vscode.ExtensionContext} context
 */
function updateWebviewContent(panel, context) {
	const webview = panel.webview;

	// Get the local paths for CSS and JS files
	const stylePathOnDisk = vscode.Uri.file(path.join(context.extensionPath, 'media', 'style.css'));
	const scriptPathOnDisk = vscode.Uri.file(path.join(context.extensionPath, 'media', 'script.js'));

	// Convert to webview URIs
	const styleUri = webview.asWebviewUri(stylePathOnDisk);
	const scriptUri = webview.asWebviewUri(scriptPathOnDisk);

	// Read the HTML content
	const fs = require('fs');
	const htmlPath = path.join(context.extensionPath, 'media', 'panel.html');
	let htmlContent = fs.readFileSync(htmlPath, 'utf8');

	// Replace the placeholders with actual URIs (use a function replacer so
	// any '$' characters in the URIs aren't treated as replacement patterns)
	htmlContent = htmlContent.replace('${styleUri}', () => styleUri.toString());
	htmlContent = htmlContent.replace('${scriptUri}', () => scriptUri.toString());
	htmlContent = htmlContent.replace(/\$\{cspSource\}/g, () => webview.cspSource);

	webview.html = htmlContent;
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
