FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all the backend source code
COPY . .

# Expose the port your backend runs on (assuming 5000, update if different)
EXPOSE 5000

# Start the application
CMD ["npm", "start"]
