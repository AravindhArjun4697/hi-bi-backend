const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const app = express();
app.get("/", (req, res) => {
  res.send("API Running Successfully");
});
app.use(cors(
  {
  origin: [
    "https://hi-bigame.online",
    "https://www.hi-bigame.online",
    "https://api.hi-bigame.online",
  ],
  credentials: true
}
));
app.use(express.json());
const SECRET_KEY = "HIBI_SECRET_KEY";
const ADMIN_SECRET_KEY = "admin_secret_key";
const server = http.createServer(app);

// const io = new Server(server, { cors: { origin: "*" }, });

const io = new Server(server, {
  cors: {
    origin: [
      "https://hi-bigame.online",
      "https://www.hi-bigame.online",
      "https://api.hi-bigame.online"
    ],
    methods: ["GET", "POST"],
    credentials: true
  }
})

const db = mysql.createConnection({
 host: "hi-bi-db.c3yuuqycknwi.ap-south-1.rds.amazonaws.com",
user: "admin",
password: "HIBI1234",
database: "gameapp",
port:3306,
authPlugins: {
  mysql_clear_password: () => () => Buffer.from("HIBI1234")
},
});

let onlineUsers = {};
let otpStore = {};


db.connect((err) => {
  
  if (err) console.log(err);
  else console.log("MySQL Connected ✅");
});

function verifyToken(req, res, next) {

  const authHeader = req.headers["authorization"];

  if (!authHeader) {
    return res.status(401).json({
      success: false,
      message: "Token Missing"
    });
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, SECRET_KEY, (err, decoded) => {

    if (err) {
      return res.status(403).json({
        success: false,
        message: "Invalid Token"
      });
    }

    req.userId = decoded.id;

    next();

  });

}



app.post("/login", (req, res) => {
  const { mobile, password } = req.body;
  db.query(
    "SELECT * FROM users WHERE mobile=? AND password=?",
    [mobile, password],
    (err, result) => {

      if (result.length === 0) {
        return res.json({
          success: false,
          message: "Invalid Login ❌"
        });
      }

      // const user = result[0];
      // delete user.password;
      const user = { ...result[0] };
      delete user.password;

      const token = jwt.sign(
        { id: user.id },
        SECRET_KEY,
        { expiresIn: "1d" }
      );

      // 🔥 already logged in check
      if (onlineUsers[user.id]) {
        return res.json({
          success: false,
          message:
            "Already Logged In Another Device ⚠️"
        });
      }

      onlineUsers[user.id] = { online: true };


      res.json({
        success: true,
        user: user,
        token: token
      });

    }
  );

});


app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;
  db.query(
    "SELECT * FROM admin WHERE username=? AND password=?",
    [username, password],
    (err, result) => {
      if (result.length === 0) {
        return res.json({
          success: false,
          message: "Invalid"
        });
      }

      const admin = result[0];

      const token = jwt.sign({
        adminId: admin.id
      },
        ADMIN_SECRET_KEY,
        { expiresIn: "1d" });

      res.json({
        success: true,
        admin: admin,
        token: token
      });


    }
  );
});



app.post("/admin/add-money", (req, res) => {
  const { userId, amount } = req.body;

  db.query(
    "UPDATE users SET balance = balance + ? WHERE id=?",
    [amount, userId],
    (err, result) => {
      res.json({
        success: true
      });
    }
  );
});



app.post("/register", (req, res) => {
  const {
    username,
    mobile,
    password
  } = req.body;

  if (
    !username ||
    !mobile ||
    !password
  ) {
    return res.json({
      success: false,
      message: "Fill all fields"
    });
  }



  db.query(
    "SELECT id FROM users WHERE mobile=?",
    [mobile],
    (err, result) => {

      if (result.length > 0) {
        return res.json({
          success: false,
          message: "Mobile already used ❌"
        });
      }

      db.query(
        "INSERT INTO users (username,mobile,password,balance) VALUES (?,?,?,0)",
        [
          username,
          mobile,
          password
        ],
        (err2) => {

          if (err2) {
            return res.json({
              success: false,
              message: "Register Failed ❌"
            });
          }

          res.json({
            success: true,
            message: "Registered Successfully ✅"
          });

        }
      );

    }
  );

});




app.post("/deposit-request", verifyToken,
  (req, res) => {

    const { userId, amount, utrNo } = req.body;

    const amt = Number(amount);

    if (
      !userId || !amt || amt <= 0 || !utrNo
    ) {
      return res.json({
        success: false,
        message:
          "Enter Amount & UTR"
      });
    }

    db.query(
      `SELECT id
       FROM deposit_requests
       WHERE utr_no=?`,
      [utrNo],
      (err, checkRes) => {

        if (
          checkRes &&
          checkRes.length > 0
        ) {
          return res.json({
            success: false,
            message: "UTR Already Used ❌"
          });
        }




        db.query(
          `INSERT INTO deposit_requests
          (user_id,amount,utr_no)
          VALUES (?,?,?)`,
          [userId, amt, utrNo],
          () => {

            res.json({
              success: true,
              message: "Deposit Request Sent ✅"
            });

          }
        );

      }
    );

  }
);



app.post("/admin/approve-deposit/:id",
  (req, res) => {
    const id = req.params.id;
    db.query(
      `SELECT * FROM deposit_requests WHERE id=? AND status='pending'`,
      [id],
      (err, result) => {

        if (err || result.length === 0) {
          return res.json({
            success: false
          });
        }

        const row = result[0];
        const userId = row.user_id;
        const amount = row.amount;


        db.query(
          "SELECT balance FROM users WHERE id=?",
          [userId],
          (err2, userRes) => {

            if (
              err2 ||
              userRes.length === 0
            ) {
              return res.json({
                success: false
              });
            }
            const before =
              userRes[0].balance;
            const after =
              before + amount;

            db.query("UPDATE users SET balance=? WHERE id=?",
              [after, userId],
              () => {
                db.query("UPDATE deposit_requests SET status='approved' WHERE id=?",
                  [id]
                );

                db.query(`INSERT INTO transactions  (user_id,type,amount,before_balance,after_balance,note) VALUES (?,?,?,?,?,?)`,
                  [userId, "credit", amount, before, after, "Deposit Approved"]);
                res.json({ success: true });
              }
            );

          }
        );

      });
  });


app.post("/withdraw-request", verifyToken,
  (req, res) => {

    const { userId, amount } = req.body;
    const amt = Number(amount);

    if (!userId || !amt || amt <= 0
    ) {
      return res.json({
        success: false, message: "Invalid Data"
      });
    }

    db.query(
      "SELECT balance FROM users WHERE id=?",
      [userId],
      (err, result) => {

        if (
          err ||
          result.length === 0
        ) {
          return res.json({
            success: false, message: "User Not Found"
          });
        }

        const balance =
          result[0].balance;
        if (
          balance < amt
        ) {
          return res.json({ success: false, message: "Low Balance ❌" });
        }

        db.query(
          `INSERT INTO  withdraw_requests (user_id, amount)  VALUES (?, ?)`,
          [userId, amt],
          () => {
            res.json({
              success: true, message: "Withdraw Request Sent ✅"
            });
          });
      });
  });



app.post("/admin/approve-withdraw/:id",
  (req, res) => {

    const id = req.params.id;

    db.query(`SELECT * FROM withdraw_requests WHERE id=? AND status='pending'`,
      [id],
      (err, result) => {

        if (
          err || result.length === 0
        ) {
          return res.json({
            success: false
          });
        }

        const row = result[0];
        const userId = row.user_id;
        const amount = row.amount;

        db.query("SELECT balance FROM users WHERE id=?",
          [userId],
          (err2, userRes) => {

            if (
              err2 ||
              userRes.length === 0
            ) {
              return res.json({
                success: false
              });
            }

            const before = userRes[0].balance;

            if (before < amount
            ) {
              return res.json({
                success: false
              });
            }

            const after = before - amount;

            db.query("UPDATE users SET balance=? WHERE id=?",
              [after, userId],
              () => {

                db.query(`UPDATE withdraw_requests   SET status='approved'  WHERE id=?`,
                  [id]
                );

                db.query(`INSERT INTO transactions (user_id,type,amount,before_balance,after_balance,note) VALUES (?,?,?,?,?,?)`,
                  [userId, "debit", amount, before, after, "Withdraw Approved"]);

                res.json({ success: true });

              }
            );

          }
        );

      }
    );

  }
);


app.post("/admin/reject-deposit/:id", (req, res) => {
  const id = req.params.id;

  db.query(`UPDATE deposit_requests  SET status='rejected'  WHERE id=? AND status='pending'`,
    [id],
    () => {
      res.json({ success: true });
    });
});



app.post("/admin/reject-withdraw/:id", (req, res) => {
  const id = req.params.id;

  db.query(`UPDATE withdraw_requests SET status='rejected' WHERE id=? AND status='pending'`,
    [id],
    () => {
      res.json({ success: true });
    });
});



app.post("/update-profile", verifyToken, (req, res) => {

  const {
    userId,
    mobile,
    address,
    upi_id,
    bank_name,
    account_no,
    ifsc
  } = req.body;

  db.query(
    `UPDATE users
       SET mobile=?,
       address=?,
       upi_id=?,
       bank_name=?,
       account_no=?,
       ifsc=?
       WHERE id=?`,
    [
      mobile,
      address,
      upi_id,
      bank_name,
      account_no,
      ifsc,
      userId
    ],
    (err) => {

      if (err) {
        return res.json({
          success: false,
          message:
            "Update Failed ❌"
        });
      }

      res.json({
        success: true,
        message:
          "Profile Saved ✅"
      });

    }
  );

}
);




app.post("/delete-account", verifyToken, (req, res) => {

  const { userId } = req.body;

  db.query("DELETE FROM users WHERE id=?", [userId], (err) => {

    if (err) {
      return res.json({
        success: false,
        message:
          "Delete Failed ❌"
      });
    }

    res.json({
      success: true,
      message:
        "Account Deleted ✅"
    });

  }
  );

}
);

app.post("/forgot-password", (req, res) => {

  const { mobile, password } = req.body;

  db.query("UPDATE users SET password=? WHERE mobile=?",
    [password, mobile],
    (err, result) => {

      if (
        err ||
        result.affectedRows === 0
      ) {
        return res.json({
          success: false,
          message:
            "Mobile Not Found ❌"
        });
      }

      res.json({
        success: true,
        message:
          "Password Updated ✅"
      });

    }
  );

}
);





// app.post("/update-password", (req, res) => {

//   const { mobile, password } = req.body;

//   db.query(
//     "UPDATE users SET password=? WHERE mobile=?",
//     [password, mobile],
//     (err, result) => {

//       if (err || result.affectedRows === 0) {
//         return res.json({
//           success: false,
//           message: "User not found ❌"
//         });
//       }

//       res.json({
//         success: true,
//         message: "Password Updated ✅"
//       });

//     }
//   );

// });




app.post("/update-password", async (req, res) => {
  const { mobile, password } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    db.query(
      "UPDATE users SET password=? WHERE mobile=?",
      [hashedPassword, mobile],
      (err, result) => {
        if (err || result.affectedRows === 0) {
          return res.json({
            success: false,
            message: "User not found ❌"
          });
        }

        res.json({
          success: true,
          message: "Password Updated ✅"
        });
      }
    );
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});




app.get("/logout/:id",
  (req, res) => {
    // delete onlineUsers[req.params.id];
    // res.json({ success: true });

    try {
      delete onlineUsers[req.params.id];
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({
        success: false
      });

    }
  });



app.get("/user/:id", verifyToken, (req, res) => {
  db.query("SELECT * FROM users WHERE id=?",
    [req.params.id],
    (err, result) => {
      if (err || result.length === 0) {
        return res.json({});
      }
      const user = result[0];
      delete user.password;
      res.json(user);
      // res.json(result[0]);
    }
  );
});


app.get("/history/:id", verifyToken, (req, res) => {
  db.query(
    "SELECT * FROM match_history WHERE user_id=? ORDER BY id DESC",
    [req.params.id],
    (err, result) => {
      res.json(result);
    });
});


app.get("/admin/users", (req, res) => {
  db.query(
    "SELECT id, username, balance FROM users ORDER BY id DESC",
    (err, result) => {
      if (err) {
        return res.json([]);
      }

      res.json(result);
    }
  );
});

app.get("/admin/revenue", (req, res) => {
  db.query(
    `SELECT 
      COUNT(*) as totalMatches,
      SUM(entry_amount) as totalEntry,
      SUM(
        CASE 
          WHEN DATE(created_at) = CURDATE()
          THEN entry_amount
          ELSE 0
        END
      ) as todayEntry
     FROM match_history
     WHERE result='WIN'`,
    (err, result) => {
      res.json(result[0]);
    }
  );
});



app.get("/admin/live-matches", (req, res) => {
  const total = Object.keys(games).length;

  res.json({
    liveMatches: total
  });
});

app.get("/admin/online-users", (req, res) => {
  res.json({
    onlineUsers: Object.keys(onlineUsers).length
  });
});

app.get("/admin/matches", (req, res) => {
  db.query(
    "SELECT COUNT(*) AS totalMatches FROM match_history WHERE result='WIN'",
    (err, result) => {
      res.json({
        totalMatches: result[0].totalMatches
      });
    }
  );
});
app.get("/admin/live-matches", (req, res) => {
  const liveMatches =
    Object.keys(games).length;

  res.json({
    liveMatches: liveMatches
  });
});

app.get("/admin/live-players", (req, res) => {
  let list = [];
  let total =
    Object.keys(games).length;

  if (total === 0) {
    return res.json([]);
  }

  for (let id in games) {
    const game = games[id];

    const p1 =
      game.players[0]?.userId;

    const p2 =
      game.players[1]?.userId;

    db.query(
      "SELECT id, username FROM users WHERE id IN (?, ?)",
      [p1, p2],
      (err, result) => {
        if (!err) {
          list.push({
            player1:
              result[0]?.username,
            player2:
              result[1]?.username,
            amount: game.amount,
            startTime: game.startTime
          });
        }

        if (
          list.length === total
        ) {
          res.json(list);
        }
      }
    );
  }
});

app.get("/transactions/:id", verifyToken, (req, res) => {

  const userId = req.params.id;

  db.query(
    `SELECT *
       FROM transactions
       WHERE user_id=?
       ORDER BY id DESC`,
    [userId],
    (err, result) => {

      if (err) {
        return res.json([]);
      }

      res.json(result);

    }
  );

}
);
app.get("/admin/deposits", (req, res) => {

  db.query(
    `SELECT *
       FROM deposit_requests
       WHERE status='pending'
       ORDER BY id DESC`,
    (err, result) => {

      if (err) {
        return res.json([]);
      }

      res.json(result);

    }
  );

}
);


app.get("/admin/withdraws", (req, res) => {

  db.query(
    `SELECT *   FROM withdraw_requests   WHERE status='pending'  ORDER BY id DESC`,
    (err, result) => {
      if (err) {
        return res.json([]);
      }
      res.json(result);

    }
  );

}
);



let waitingPlayers = {};

let games = {};
let users = new Set();



io.on("connection", (socket) => {


  console.log("🔥 Connected:", socket.id);
  users.add(socket.id);
  io.emit("onlinePlayers", users.size);

  socket.on(
    "userOnline",
    (userId) => {

      socket.userId = userId;

      onlineUsers[userId] = {
        online: true,
        socketId: socket.id
      };

    });



  socket.on("joinGame", ({ userId, amount }) => {

    const allowed = [20, 50, 100];

    if (!allowed.includes(amount)) {
      socket.emit("joinError");
      return;
    }

    if (!userId) return;

    let waitingPlayer =
      waitingPlayers[amount];

    const alreadyPlaying =
      Object.values(games).find(
        (game) =>
          game.players.some(
            (p) =>
              p.userId === userId
          )
      );

    if (alreadyPlaying) return;

    if (
      waitingPlayers[amount] &&
      waitingPlayers[amount].userId === userId
    ) {
      socket.emit("waiting");
      return;
    }

    db.query(
      "SELECT balance FROM users WHERE id=?",
      [userId],
      (err, result) => {

        if (
          err ||
          result.length === 0
        ) {
          return;
        }

        const before =
          result[0].balance;

        if (before < amount) {
          socket.emit(
            "lowBalance"
          );
          return;
        }

        const after =
          before - amount;

        db.query(
          "UPDATE users SET balance=? WHERE id=?",
          [after, userId],
          () => {

            db.query(
              `INSERT INTO transactions
            (user_id,type,amount,before_balance,after_balance,note)
            VALUES (?,?,?,?,?,?)`,
              [
                userId,
                "debit",
                amount,
                before,
                after,
                "Join Game Entry"
              ]
            );

            // FIRST PLAYER
            if (
              !waitingPlayers[amount]
            ) {

              waitingPlayers[amount] = {
                socket,
                userId,
                amount
              };

              socket.emit(
                "waiting"
              );

              waitingPlayers[
                amount
              ].waitTimer =
                setTimeout(() => {

                  if (
                    waitingPlayers[
                    amount
                    ] &&
                    waitingPlayers[
                      amount
                    ].userId === userId
                  ) {

                    db.query(
                      "UPDATE users SET balance = balance + ? WHERE id=?",
                      [
                        amount,
                        userId
                      ]
                    );

                    db.query(
                      `INSERT INTO transactions
                    (user_id,type,amount,before_balance,after_balance,note)
                    VALUES (?,?,?,?,?,?)`,
                      [
                        userId,
                        "credit",
                        amount,
                        after,
                        before,
                        "No Opponent Refund"
                      ]
                    );

                    socket.emit(
                      "noOpponent"
                    );

                    waitingPlayers[
                      amount
                    ] = null;

                  }

                }, 20000);

              return;
            }

            // SECOND PLAYER
            waitingPlayer =
              waitingPlayers[amount];

            clearTimeout(
              waitingPlayer.waitTimer
            );

            waitingPlayers[
              amount
            ] = null;

            const gameId =
              Date.now();

            games[gameId] = {
              players: [
                {
                  socket:
                    waitingPlayer.socket,
                  userId:
                    waitingPlayer.userId
                },
                {
                  socket: socket,
                  userId: userId
                }
              ],
              board:
                Array(9).fill(null),
              currentTurn: "X",
              amount: amount,
              startTime:
                Date.now(),
              finished: false
            };

            waitingPlayer.socket.emit(
              "startGame",
              {
                gameId,
                symbol: "X",
                turn: "X"
              }
            );

            socket.emit(
              "startGame",
              {
                gameId,
                symbol: "O",
                turn: "X"
              }
            );

          }
        );

      }
    );

  });

  socket.on("playerMove", (data) => {
    const { gameId, symbol, type, index, from, to } = data;

    const game = games[gameId];
    if (!game) return;

    if (game.currentTurn !== symbol) return;

    clearTimeout(game.timer);

    if (type === "place") {
      if (game.board[index] !== null) return;
      game.board[index] = symbol;
    }

    if (type === "move") {
      if (game.board[from] !== symbol) return;
      if (game.board[to] !== null) return;

      game.board[from] = null;
      game.board[to] = symbol;
    }

    game.currentTurn = symbol === "X" ? "O" : "X";

    game.players.forEach((p) => {
      p.socket.emit("opponentMove", {
        board: game.board,
        currentTurn: game.currentTurn,
      });
    });

    startTimer(gameId);
  });

  socket.on("gameOver", ({ gameId, winnerId }) => {

    const game = games[gameId];
    if (!game) return;
    if (game.ended) return;
    game.ended = true;

    clearTimeout(game.timer);

    const winAmount = game.amount * 2;

    const loser = game.players.find((p) => p.userId != winnerId);
    const loserId = loser.userId;

    db.query(
      "UPDATE users SET balance=balance+? WHERE id=?",
      [winAmount, winnerId],
      () => {
        game.players.forEach((p) => {
          p.socket.emit("gameEnded", { winnerId });
        });
        db.query(
          "INSERT INTO match_history (user_id, opponent_id, result, entry_amount, win_amount) VALUES (?, ?, ?, ?, ?)",
          [winnerId, loserId, "WIN", game.amount, winAmount]
        );

        db.query(
          "INSERT INTO match_history (user_id, opponent_id, result, entry_amount, win_amount) VALUES (?, ?, ?, ?, ?)",
          [loserId, winnerId, "LOSE", game.amount, 0]
        );

        delete games[gameId];
      }
    );
  });
  socket.on("exitGame", ({ gameId, userId }) => {
    const game = games[gameId];
    if (!game) return;
    if (game.ended) return;
    game.ended = true;

    clearTimeout(game.timer);

    const winner = game.players.find(
      (p) => p.userId != userId
    );

    if (!winner) return;

    db.query(
      "UPDATE users SET balance = balance - ? WHERE id=?",
      [game.amount * 2, winner.userId],
      () => {
        game.players.forEach((p) => {
          p.socket.emit("gameEnded", {
            winnerId: winner.userId
          });
        });

        delete games[gameId];
      }
    );
  });

  socket.on("disconnect", () => {


    console.log("❌ Disconnected:", socket.id);
    users.delete(socket.id);
    io.emit("onlinePlayers", users.size);

    // for (let id in onlineUsers) {

    //   if (
    //     onlineUsers[id]
    //       ?.socketId ===
    //     socket.id
    //   ) {
    //     delete onlineUsers[id];
    //   }

    // }


    console.log("User disconnected");

    for (let userId in onlineUsers) {

      if (onlineUsers[userId] === socket.id) {

        delete onlineUsers[userId];
        io.emit(
          "onlinePlayers",
          Object.keys(onlineUsers).length
        );
        break;
      }
    }

    // waiting refund only
    for (let amt in waitingPlayers) {
      if (
        waitingPlayers[amt] &&
        waitingPlayers[amt].socket.id === socket.id
      ) {


        clearTimeout(waitingPlayers[amt].waitTimer);

        db.query(
          "UPDATE users SET balance = balance + ? WHERE id=?",
          [
            waitingPlayers[amt].amount,
            waitingPlayers[amt].userId
          ]
        );

        waitingPlayers[amt] = null;
        return;
      }
    }

    // active game lose
    for (let gameId in games) {
      const game = games[gameId];

      const loser = game.players.find(
        (p) => p.socket.id === socket.id
      );

      if (loser) {
        if (game.ended) return;

        game.ended = true;

        clearTimeout(game.timer);

        const winner = game.players.find(
          (p) => p.socket.id !== socket.id
        );

        db.query(
          "UPDATE users SET balance = balance + ? WHERE id=?",
          [game.amount * 2, winner.userId],
          () => {
            game.players.forEach((p) => {
              p.socket.emit("gameEnded", {
                winnerId: winner.userId
              });
            });

            delete games[gameId];
          }
        );

        return;
      }
    }

  });
  function startTimer(gameId) {
    const game = games[gameId];
    if (!game) return;

    clearTimeout(game.timer);

    game.timer = setTimeout(() => {
      const currentGame = games[gameId];
      if (!currentGame) return;

      if (currentGame.ended) return;
      currentGame.ended = true;

      const loserSymbol = currentGame.currentTurn;


      const winner = currentGame.players.find((p) => p.symbol !== currentGame.currentTurn);

      const winAmount =
        Number(currentGame.amount) * 2;

      db.query(
        "UPDATE users SET balance = balance + ? WHERE id=?",
        [winAmount, winner.userId],
        () => {
          currentGame.players.forEach((p) => {
            p.socket.emit("gameEnded", {
              winnerId: winner.userId
            });
          });

          delete games[gameId];
        }
      );
    }, 20000);
  }

  function refund(game) {
    // game.players.forEach((p) => {
    //   db.query(
    //     "UPDATE users SET balance=balance+? WHERE id=?",
    //     [game.amount, p.userId]
    //   );
    // });
    return;
  }
});

server.listen(3001, "0.0.0.0", () => {
  console.log("🚀 Server running on 3001");
});