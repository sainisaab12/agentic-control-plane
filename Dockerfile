# Use official lightweight Python image
FROM python:3.10-slim

# Set working directory
WORKDIR /app

# Copy requirements file and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all project files to container
COPY . .

# Expose server port (FastAPI defaults to 5174 in our script)
EXPOSE 5174

# Define environment variables
ENV PORT=5174

# Start server
CMD ["python", "server.py"]
