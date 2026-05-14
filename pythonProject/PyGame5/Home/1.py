import os
import sys

import pygame


def load_image(name, colorkey=None):
    fullname = os.path.join('data', name)
    # если файл не существует, то выходим
    if not os.path.isfile(fullname):
        print(f"Файл с изображением '{fullname}' не найден")
        sys.exit()
    image = pygame.image.load(fullname)
    if colorkey is not None:
        image = image.convert()
        if colorkey == -1:
            colorkey = image.get_at((0, 0))
        image.set_colorkey(colorkey)
    else:
        image = image.convert_alpha()
    return image


class Dracon(pygame.sprite.Sprite):
    image_right = None
    image_left = None
    image_up = None
    image_down = None

    def __init__(self, group, size):
        # НЕОБХОДИМО вызвать конструктор родительского класса Sprite
        super().__init__(group)
        if Dracon.image_right is None:
            Dracon.image_open = load_image("kon.png")
            Dracon.image_open = pygame.transform.scale(Dracon.image_open, (50, 50))
            Dracon.image_open=pygame.transform.rotate(Dracon.image_open,-180)
            Dracon.image_right = pygame.transform.flip(Dracon.image_open, True,False)
            Dracon.image_left = pygame.transform.flip(Dracon.image_right, True, False)


        self.width, self.height = size
        self.image = Dracon.image_right

        self.rect = self.image.get_rect()

        self.vx = 1
        self.vy = 1
        # считаем количество тиков для замедления
        self.ticks = 0

    def update(self):
        if self.rect.left + self.rect.width > self.width or self.rect.left < 0:
            self.vx = -self.vx
            if self.vx > 0:
                self.image = Dracon.image_right
            else:
                self.image = Dracon.image_left
        self.rect.left = self.rect.left + self.vx
        self.ticks = 0



def main():
    size = 600, 60
    screen = pygame.display.set_mode(size)
    pygame.display.set_caption('Dracon')
    clock = pygame.time.Clock()
    # группа, содержащая все спрайты
    all_sprites = pygame.sprite.Group()

    _ = Dracon(all_sprites, size)

    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
        screen.fill(pygame.Color("white"))
        all_sprites.draw(screen)
        all_sprites.update()
        pygame.display.flip()
        clock.tick(50)
    pygame.quit()


if __name__ == '__main__':
    main()
