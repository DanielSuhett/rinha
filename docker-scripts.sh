#!/bin/bash

# Docker Compose helper script for Rinha project

case "$1" in
    "build")
        echo "Building Docker images..."
        docker-compose build
        ;;
    "up")
        echo "Starting services..."
        docker-compose up -d
        ;;
    "down")
        echo "Stopping services..."
        docker-compose down
        ;;
    "logs")
        if [ -n "$2" ]; then
            docker-compose logs -f $2
        else
            docker-compose logs -f
        fi
        ;;
    "restart")
        echo "Restarting services..."
        docker-compose restart
        ;;
    "status")
        echo "Service status:"
        docker-compose ps
        ;;
    "clean")
        echo "Cleaning up..."
        docker-compose down --volumes --remove-orphans
        docker system prune -f
        ;;
    *)
        echo "Usage: $0 {build|up|down|logs|restart|status|clean}"
        echo "  build   - Build Docker images"
        echo "  up      - Start all services"
        echo "  down    - Stop all services"
        echo "  logs    - View logs (optional service name)"
        echo "  restart - Restart services"
        echo "  status  - Show service status"
        echo "  clean   - Clean up containers and volumes"
        exit 1
        ;;
esac 