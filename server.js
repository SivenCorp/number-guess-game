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
    },
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
        skipMiddlewares: true
    }
});

app.use(express.static(path.join(__dirname, 'public')));

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Проверка здоровья
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        games: games.size,
        time: new Date().toISOString() 
    });
});

// Хранилище игр
const games = new Map();

// Логирование состояния каждые 30 секунд
setInterval(() => {
    console.log(`=== Статус сервера: ${games.size} активных игр ===`);
    for (const [gameId, game] of games.entries()) {
        const age = Math.floor((Date.now() - game.createdAt) / 1000);
        console.log(`Игра ${gameId}: создана ${age} сек назад, игроков: ${game.players.length}, догадок: ${game.guesses.length}`);
    }
    if (games.size === 0) {
        console.log('Нет активных игр');
    }
}, 30 * 1000);

// Генерация случайного числа
function generateNumber() {
    return Math.floor(Math.random() * 100) + 1;
}

// WebSocket логика
io.on('connection', (socket) => {
    console.log('✅ Новое подключение:', socket.id);

    socket.on('create_game', () => {
        console.log('🔄 Запрос на создание игры от:', socket.id);
        
        const gameId = Math.random().toString(36).substring(2, 8).toUpperCase();
        const secretNumber = generateNumber();
        
        games.set(gameId, {
            secretNumber,
            players: [socket.id],
            guesses: [],
            createdAt: Date.now()
        });

        console.log(`🎮 Создана игра ${gameId}. Игрок: ${socket.id}`);
        console.log(`📊 Всего игр в памяти: ${games.size}`);
        
        socket.join(gameId);
        socket.emit('game_created', { 
            gameId, 
            message: 'Комната создана. Поделитесь кодом с другом.' 
        });
        
        // Отправляем событие waiting создателю
        socket.emit('waiting', { 
            message: 'Ожидаем второго игрока...',
            gameId: gameId
        });
    });

    socket.on('join_game', (data) => {
        const gameId = data.gameId || data;
        console.log(`🔍 Поиск игры ${gameId} для игрока ${socket.id}`);
        console.log(`📋 Доступные игры: ${Array.from(games.keys()).join(', ') || 'нет'}`);
        
        const game = games.get(gameId);
        if (!game) {
            console.log(`❌ Игра ${gameId} не найдена!`);
            socket.emit('error', { message: 'Игра не найдена. Проверьте код.' });
            return;
        }

        console.log(`✅ Игра ${gameId} найдена. Игроков: ${game.players.length}`);

        // Проверка времени (игра живет 10 минут)
        const now = Date.now();
        const gameAge = now - game.createdAt;
        if (gameAge > 10 * 60 * 1000) {
            console.log(`⏰ Игра ${gameId} устарела (${Math.floor(gameAge/1000)} сек)`);
            games.delete(gameId);
            socket.emit('error', { message: 'Игра устарела. Создайте новую.' });
            return;
        }

        if (game.players.length >= 2) {
            console.log(`🚫 Комната ${gameId} заполнена`);
            socket.emit('error', { message: 'Комната заполнена' });
            return;
        }

        // Проверяем, не присоединяется ли тот же игрок
        if (game.players.includes(socket.id)) {
            console.log(`⚠️ Игрок ${socket.id} уже в игре ${gameId}`);
            socket.join(gameId);
            socket.emit('waiting', { 
                message: 'Вы уже в игре. Ожидаем второго игрока...' 
            });
            return;
        }

        // Добавляем второго игрока
        game.players.push(socket.id);
        socket.join(gameId);
        
        console.log(`✅ Игрок ${socket.id} присоединился к игре ${gameId}`);
        console.log(`👥 Теперь игроков: ${game.players.length}`);

        if (game.players.length === 2) {
            console.log(`🎉 Оба игрока в игре ${gameId}! Начинаем!`);
            io.to(gameId).emit('game_start', { 
                message: 'Оба игрока готовы! Введите числа от 1 до 100',
                gameId: gameId
            });
        } else {
            socket.emit('waiting', { 
                message: 'Ожидаем второго игрока...',
                gameId: gameId
            });
        }
    });

    socket.on('submit_guess', (data) => {
        const gameId = data.gameId;
        const guess = data.guess;
        
        console.log(`🎯 Получено число ${guess} для игры ${gameId} от ${socket.id}`);
        
        const game = games.get(gameId);
        if (!game) {
            console.log(`❌ Игра ${gameId} не найдена при отправке числа`);
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
            guess: guessNum,
            timestamp: Date.now()
        });

        console.log(`✅ Число ${guessNum} сохранено. Всего догадок: ${game.guesses.length}`);

        // Уведомляем всех в комнате о прогрессе
        io.to(gameId).emit('guess_received', {
            player: socket.id,
            totalGuesses: game.guesses.length,
            needed: 2
        });

        if (game.guesses.length === 2) {
            const secret = game.secretNumber;
            const results = game.guesses.map(g => ({
                player: g.player,
                guess: g.guess,
                difference: Math.abs(g.guess - secret)
            }));

            // Определяем победителя (меньшая разница выигрывает)
            const winner = results[0].difference <= results[1].difference ? 
                results[0].player : results[1].player;
            
            console.log(`🏆 Игра ${gameId} завершена! Загаданное число: ${secret}`);
            console.log(`📊 Результаты:`, results);
            console.log(`🎖️ Победитель: ${winner}`);
            
            io.to(gameId).emit('game_result', {
                secretNumber: secret,
                guesses: results,
                winner: winner,
                isTie: results[0].difference === results[1].difference,
                message: winner === socket.id ? '🎉 Вы победили!' : '😢 Вы проиграли'
            });

            // Удаляем игру через 10 секунд после завершения
            setTimeout(() => {
                if (games.has(gameId)) {
                    games.delete(gameId);
                    console.log(`🗑️ Игра ${gameId} удалена из памяти`);
                }
            }, 10000);
        }
    });

    socket.on('get_game_status', (gameId) => {
        const game = games.get(gameId);
        if (game) {
            socket.emit('game_status', {
                players: game.players.length,
                guesses: game.guesses.length,
                gameId: gameId
            });
        }
    });

    socket.on('disconnect', (reason) => {
        console.log(`❌ Отключение: ${socket.id}, причина: ${reason}`);
    });

    socket.on('error', (error) => {
        console.error(`⚠️ Ошибка сокета ${socket.id}:`, error);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`🌍 NODE_ENV: ${process.env.NODE_ENV}`);
    console.log(`⏰ Время запуска: ${new Date().toLocaleString()}`);
    console.log(`📡 WebSocket готов к подключениям`);
});
