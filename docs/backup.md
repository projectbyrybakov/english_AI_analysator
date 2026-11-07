# Бэкап и восстановление

Дампы содержат личные занятия. Храните их вне репозитория (`*.dump` в `.gitignore`).

## Docker Compose

```bash
# бэкап
docker compose exec -T db pg_dump -U eia -d eia -Fc > backup-$(date +%F).dump

# восстановление в пустую базу
docker compose exec -T db dropdb -U eia --if-exists eia
docker compose exec -T db createdb -U eia eia
docker compose exec -T db pg_restore -U eia -d eia < backup-YYYY-MM-DD.dump
```

## Без Docker

```bash
pg_dump -d eia -Fc > backup-$(date +%F).dump
createdb eia_restore && pg_restore -d eia_restore backup-YYYY-MM-DD.dump
```

## Проверка восстановления

После восстановления в отдельную базу (`eia_restore`) запустите backend с `DATABASE_URL` на неё и откройте список занятий. Автоматические бэкапы и регулярная проверка восстановления — этап 4.
