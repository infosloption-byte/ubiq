FROM php:8.2-fpm

RUN apt-get update && apt-get install -y \
    curl libpng-dev libonig-dev libxml2-dev libzip-dev zip unzip sqlite3 git libsqlite3-dev docker.io \
    && docker-php-ext-install zip pdo_mysql mbstring exif pcntl bcmath gd pdo_sqlite

COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

CMD php artisan migrate --force && php-fpm
