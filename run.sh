#!/bin/bash

# HeadWave - Simple startup script

# Activate virtual environment
source venv/bin/activate

# Start the server
uvicorn main:app --reload
