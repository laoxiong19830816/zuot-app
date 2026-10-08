FROM python:3.11-slim

WORKDIR /app

# 国内可选阿里云镜像加速：pip install -i https://mirrors.aliyun.com/pypi/simple/
RUN pip install --no-cache-dir -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/ || \
    pip install --no-cache-dir -r requirements.txt

COPY akshare_service.py ./

ENV TZ=Asia/Shanghai
ENV PYTHONUNBUFFERED=1
EXPOSE 8620

CMD ["python", "akshare_service.py", "--host", "0.0.0.0", "--port", "8620"]
