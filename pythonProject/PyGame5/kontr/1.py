'''Вводятся строки, пока не будет введена строка ROCK.
Формат вывода
Выведите наименьшую и наибольшую длину строк, \
содержащих замок (castle) в любом регистре, \
а затем среднюю длину таких строк. Округлять не нужно.'''
dl = []
while True:
    stroka = input().lower()
    if 'castle' in stroka:
        dl.append(len(stroka))
    if 'ROCK' in stroka:
        break
print(min(dl))
print(max(dl))
print(sum(dl) / len(dl))
