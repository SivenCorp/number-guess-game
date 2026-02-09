const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(path.join(__dirname, 'public')));

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Хранилище игр
const games = new Map();

// Очистка старых игр каждые 5 минут
setInterval(() => {
    const now = Date.now();
    for (const [gameId, game] of games.entries()) {
        if (now - game.createdAt > 30 * 60 * 1000) {
            games.delete(gameId);
            console.log('Удалена старая игра:', gameId);
        }
    }
}, 5 * 60 * 1000);

// Генерация случайного числа
function generateNumber() {
    return Math.floor(Math.random() * 100) + 1;
}

// WebSocket логика
io.on('connection', (socket) => {
    console.log('Новое подключение:', socket.id);

    socket.on('create_game', () => {
        const gameId = Math.random().toString(36).substring(7);
        const secretNumber = generateNumber();
        
        games.set(gameId, {
            secretNumber,
            players: [],
            guesses: [],
            createdAt: Date.now()
        });

        console.log('Создана игра:', gameId);
        socket.join(gameId);
        socket.emit('game_created', { 
            gameId, 
            message: 'Комната создана. Поделитесь кодом с другом.' 
        });
    });

    socket.on('join_game', (gameId) => {
        console.log('Поиск игры:', gameId);
        console.log('Доступные игры:', Array.from(games.keys()));
        
        const game = games.get(gameId);
        if (!game) {
            console.log('Игра не найдена:', gameId);
            socket.emit('error', { message: 'Игра не найдена' });
            return;
        }

        const now = Date.now();
        if (now - game.createdAt > 30 * 60 * 1000) {
            games.delete(gameId);
            socket.emit('error', { message: 'Игра устарела' });
            return;
        }

        if (game.players.length >= 2) {
            socket.emit('error', { message: 'Комната заполнена' });
            return;
        }

        socket.join(gameId);
        game.players.push(socket.id);
        
        console.log('Игрок присоединился:', socket.id, 'к игре:', gameId);
        
        if (game.players.length === 2) {
            io.to(gameId).emit('game_start', { 
                message: 'Оба игрока готовы! Введите числа от 1 до 100' 
            });
        } else {
            socket.emit('waiting', { 
                message: 'Ожидаем второго игрока...' 
            });
        }
    });

    socket.on('submit_guess', ({ gameId, guess }) => {
        const game = games.get(gameId);
        if (!game) {
            socket.emit('error', { message: 'Игра не найдена' });
            return;
        }

        const playerIndex = game.players.indexOf(socket.id);
        if (playerIndex === -1) {
            socket.emit('error', { message: 'Вы не участник игры' });
            return;
        }

        const guessNum = parseInt(guess);
        if (isNaN(guessNum) || guessNum < 1 || guessNum > 100) {
            socket.emit('error', { message: 'Число должно быть от 1 до 100' });
            return;
        }

        // Проверяем, не отправил ли уже игрок число
        const alreadyGuessed = game.guesses.some(g => g.player === socket.id);
        if (alreadyGuessed) {
            socket.emit('error', { message: 'Вы уже отправили число' });
            return;
        }

        game.guesses.push({
            player: socket.id,
            guess: guessNum
        });

        console.log('Получено число:', guessNum, 'для игры:', gameId);

        if (game.guesses.length === 2) {
            const secret = game.secretNumber;
            const results = game.guesses.map(g => ({
                player: g.player,
                guess: g.guess,
                difference: Math.abs(g.guess - secret)
            }));

            const winner = results[0].difference <= results[1].difference ? 
                results[0].player : results[1].player;
            
            console.log('Результаты игры:', gameId, {
                secretNumber: secret,
                guesses: results,
                winner: winner
            });
            
            io.to(gameId).emit('game_result', {
                secretNumber: secret,
                guesses: results,
                winner: winner,
                message: winner === socket.id ? '🎉 Вы победили!' : '😢 Вы проиграли'
            });

            games.delete(gameId);
            console.log('Игра завершена и удалена:', gameId);
        }
    });

    socket.on('disconnect', () => {
        console.log('Отключение:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
});
