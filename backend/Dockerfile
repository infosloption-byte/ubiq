FROM php:8.2-fpm

# FIX #9: docker.io removed from this image.
#
# The previous Dockerfile installed the full Docker CLI (docker.io) into the
# ubiq_api container so Laravel could spawn sandbox containers by shelling out
# to `docker run`. That required mounting /var/run/docker.sock, giving the
# entire Laravel process tree unrestricted Docker daemon access.
#
# With the socket-proxy in docker-compose.yml, ubiq_api reaches Docker via TCP
# (DOCKER_HOST=tcp://socket-proxy:2375). The Docker CLI binary in the image
# talks to that TCP endpoint automatically — no socket mount needed.
#
# We still need the docker CLI binary to shell out to `docker run/stop/rm`, so
# we install docker-ce-cli (the client only, no daemon) from Docker's own apt
# repo rather than docker.io (which pulls in the full daemon package and wastes
# ~120 MB on an image that should never run a daemon).

RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    gnupg \
    lsb-release \
    libpng-dev \
    libonig-dev \
    libxml2-dev \
    libzip-dev \
    zip \
    unzip \
    sqlite3 \
    git \
    libsqlite3-dev \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg \
       | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    && echo \
       "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
       https://download.docker.com/linux/debian \
       $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
       | tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && apt-get update \
    && apt-get install -y docker-ce-cli \
    && docker-php-ext-install zip pdo_mysql mbstring exif pcntl bcmath gd pdo_sqlite \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

CMD php artisan migrate --force && php-fpm