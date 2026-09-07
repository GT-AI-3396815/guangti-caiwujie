# 光体•财无界 — 容器化部署
# 构建后运行：docker build -t guangti-caiwujie . && docker run -p 8642:8642 -v guangti-data:/app/data guangti-caiwujie
FROM node:20-alpine

WORKDIR /app
COPY index.html server.js ./
COPY assets ./assets
COPY tests ./tests

ENV PORT=8642
EXPOSE 8642

# 数据卷挂载点（账号/账本/任务数据）
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://localhost:8642/api/rank > /dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
