FROM node:18

# Install Python + ffmpeg
RUN apt-get update && \
    apt-get install -y python3 python3-pip ffmpeg && \
    pip3 install yt-dlp

WORKDIR /app

# Copy only package files first (cache optimization)
COPY package*.json ./
RUN npm install

# Copy rest of files
COPY . .

# Start server
CMD ["node", "server.js"]
