FROM node:18-bullseye

# Install Python + ffmpeg properly
RUN apt-get update && \
    apt-get install -y python3 python3-pip ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Install yt-dlp
RUN pip3 install yt-dlp

WORKDIR /app

# Install node deps first
COPY package*.json ./
RUN npm install

# Copy rest
COPY . .

# Start server
CMD ["node", "server.js"]
