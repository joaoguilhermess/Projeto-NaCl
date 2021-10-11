const nacl = require("tweetnacl")
const util = require("tweetnacl-util");
const app = require("express")();
const http = require("http").Server(app);
const io = require("socket.io")(http);

var keys = nacl.box.keyPair();

function encrypt(message, key) {
	// if (typeof key == "string") {
		// key = util.decodeBase64(key);
	// }
	// if (typeof message == "object") {
		// message = JSON.stringify(message);
	// }
	message = JSON.stringify(message);
	var nonce = nacl.randomBytes(nacl.box.nonceLength);
	var array = util.decodeUTF8(message);
	var encrypted = nacl.box(array, nonce, key, keys.secretKey);
	var content = new Uint8Array(nonce.length + encrypted.length);
	content.set(nonce);
	content.set(encrypted, nonce.length);
	return util.encodeBase64(content); 
}

function decrypt(message, key) {
	if (typeof key == "string") {
		key = util.decodeBase64(key);
	}
	var array = util.decodeBase64(message);
	var nonce = array.slice(0, nacl.box.nonceLength);
	var content = array.slice(nacl.box.nonceLength, array.length);
	var decrypted = nacl.box.open(content, nonce, key, keys.secretKey);
	return util.encodeUTF8(decrypted);
}

app.get("/", function(req, res) {
	res.sendFile(__dirname + "//index.html");
});

app.get("/whitneymedium", function(req, res) {
	res.sendFile(__dirname + "//whitneymedium.woff");
});

app.get("/nacl.js", function(req, res) {
	res.sendFile(__dirname + "//nacl-fast.min.js");
});

app.get("/nacl-util.js", function(req, res) {
	res.sendFile(__dirname + "//nacl-util.min.js");
});
app.get("/favicon.ico", function(req, res) {
	res.status(404);
});

var rooms = {};

io.sockets.on("connection", function(socket) {
	socket.on("serverKey", function(callback) {
		try {
			if (typeof callback != "function") {return;}

			if (!socket.logged) {
				return callback(util.encodeBase64(keys.publicKey));
			}
			callback(false);
		} catch (e) {
			console.error(`serverKey(${typeof callback}); Error: ${e}`);
		}
	});
	socket.on("login", function(name, publicKey, callback) {
		try {
			if (typeof name != "string") {return;}
			if (typeof publicKey != "string") {return;}
			if (typeof callback != "function") {return;}
			publicKey = util.decodeBase64(publicKey);
			name = decrypt(name, publicKey);

			if (!socket.logged && !socket.name) {
				socket.logged = true;
				socket.name = name;
				socket.publicKey = publicKey;
				socket.nonce = util.encodeBase64(nacl.randomBytes(nacl.box.nonceLength));
				return callback(encrypt(socket.nonce, socket.publicKey), encrypt(socket.id, socket.publicKey));
			}
			callback();
		} catch (e) {
			console.error(`login(${name}, ${util.encodeBase64(publicKey)}, ${typeof callback}); Error: ${e}`);
			callback();
		}
	});
	socket.on("publicKey", function(publicKey, callback) {
		try {
			if (typeof publicKey != "string") {return;}
			if (typeof (publicKey = util.decodeBase64(publicKey)) != "object") {return;}
			if (typeof callback != "function") {return;}
			if (!socket.logged) {return;}
			publicKey = util.decodeBase64(decrypt(publicKey, socket.publicKey));

			if (publicKey.length == nacl.box.publicKeyLength) {
				if (io.socket.adapter.rooms[socket.room]) {
					var room = rooms[socket.room];
					for (var i = 0; i < room.clients.length; i++) {
						socket.to(room.clients[i]).emit("publicKey", encrypt({"id": socket.id, "key": socket.publicKey}, room.clients[i].publicKey));
					}
				}
				return callback(true);
			}
			callback(false);
		} catch (e) {
			console.error(`public(${publicKey}, ${typeof callback}); Error: ${e}`);
		}
	});
	socket.on("create", function(callback) {
		// try {
			if (typeof callback != "function") {return;}
			if (!socket.logged) {return;}
			if (socket.room) {return;}

			const az = "abcdefghijklmnopqrstuvwxyz";
			
			while (true) {
				var room = "";
				for (var i = 0; i < 5; i++) {
					room += az[Math.floor(Math.random() * az.length)];
				}
				if (!io.sockets.adapter.rooms[room]) {
					socket.join(room);
					socket.room = room;
					socket.owner = true;
					rooms[socket.room] = {};
					rooms[socket.room].owner = socket;
					rooms[socket.room].clients = [];
					rooms[socket.room].clients.push(socket);
					return callback(encrypt({"roomId": room}, socket.publicKey));
				}
			}
			// callback(false);
		// } catch (e) {
		// 	console.error(`create(${typeof callback}); Error: ${e}`);
		// }
	});
	socket.on("join", function(room, callback) {
		try {
			if (typeof room != "string") {return};
			if (typeof callback != "function") {return;}
			if (!socket.logged) {return;}
			if (socket.room) {return;}
			room = decrypt(room, socket.publicKey);

			if (io.sockets.adapter.rooms.includes(room)) {
				socket.join(room);
				socket.room = room;
				socket.owner = false;
				rooms[socket.room].clients.push(socket);
				var room = rooms[socket.room];
				socket.to(rooms[socket.room].owner.id).emit("ask", encrypt({"id": socket.id, "name": socket.name}, rooms[socket.room].owner.publicKey), function (permission) {
					if (permission) {
						for (var i = 0; i < room.clients.length; i++) {
							socket.to(room.clients[i]).emit("join", encrypt({"id": socket.id}, room.clients[i].publicKey));
							return callback(true);
						}
					} else {
						return callback(false);
					}
				});
			}
			callback(false);
		} catch (e) {
			console.error(`join(${room}, ${typeof callback}); Error: ${e}`);
		}
	});
	socket.on("rooms", function(callback) {
		try {
			if (typeof callback != "function") {return;}
			var roomsList = Object.keys(rooms);
			var result;
			for (var i = 0; i < roomsList.length; i++) {
				var room = rooms[roomsList[i]];
				console.log(room);
				var roomClients = [];
				for (var l = 0; l < room.clients.length; l++) {
					roomClients.push({
						name: room.clients[l].name,
						id: room.clients[l].id,
						code: room.clients[l].name + '#"' + room.clients[l].id + '"',
						owner: room.clients[l].owner,
						publicKey: room.clients[l].publicKey
					});
				}
				result = {
					name: roomsList[i],
					clients: roomClients
				};
			}
			console.log(result);
			callback(result);
		} catch (e) {
			console.error(`rooms(${typeof callback}); Error: ${e}`);
		}
	})
	socket.on("message", function(message, callback) {
		try {
			if (typeof message != "string") {return};
			if (typeof callback != "function") {return;}
			if (!socket.logged) {return;}
			message = decrypt(message, socket.publicKey);

			var room = rooms[socket.room];
			for (var i = 0; i < room.clients.length; i++) {
				socket.to(room.clients[i]).emit("message", encrypt({"id": socket.id, "code": socket.nonce, "message": message}, room.clients[i].publicKey));
				return callback(true);
			} 
			callback(false);
		} catch (e) {
			console.error(`message(${message}, ${typeof callback}); Error: ${e}`);
		}
	});
	socket.on("read", function(code, callback) {
		try {
			if (typeof message != "string") {return};
			if (typeof callback != "function") {return;}
			if (!socket.logged) {return;}
			code = decrypt(code, socket.publicKey);

			var room = rooms[socket.room];
			for (var i = 0; i < room.clients.length; i++) {
				socket.to(room.clients[i]).emit("read", encrypt({"id": socket.id, "code": code}, room.clients[i].publicKey));
				return callback(true);
			} 
			callback(false);

		} catch (e) {
			console.error(`message(${message}, ${typeof callback}); Error: ${e}`);
		}
	});
	socket.on("disconnecting", function() {
		try {
			if (!socket.logged) {return;}
			if (socket.room) {
				var room = rooms[socket.room];
				for (var i = 0; i < room.clients.length; i++) {
					socket.to(room.clients[i]).emit("leave", encrypt({"id": socket.id, "close": socket.owner}, room.clients[i].publicKey));
					if (socket.owner) {
						room.clients[i].leave(socket.room);
						delete room.clients[i];
					}
				}
				if (socket.owner) {
					delete rooms[socket.room];
				}	
			}
			
			delete socket;
		} catch (e) {
			console.error(`disconnecting(${socket.id}); Error: ${e}`);
		}
	});
});

const port = 4000;

http.listen(port, function() {
	console.log("Ready");
});